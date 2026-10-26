use std::process::{Command, Child};
use std::sync::Mutex;
use std::net::TcpStream;
use std::time::{Duration, Instant};
use std::path::PathBuf;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// 窗口等比缩放约束（2026-10-25）：拦 WM_SIZING 让窗口只能按 16:10 拖动
#[cfg(windows)]
mod window_aspect;

/// 读取 sidecar-info.json 获取端口和启动信息
/// 注意：JSON 字段用 camelCase（与 build-for-tauri.mjs 写入的一致）
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarInfo {
    port: u16,
    host: String,
    url: String,
    start_script: String,
    node_exe: String,
    #[allow(dead_code)]
    app_dir: String,
}

struct AppState {
    node_process: Mutex<Option<Child>>,
}

/// 用 TCP 探测端口是否可连接
fn wait_for_port(host: &str, port: u16, timeout_secs: u64) -> bool {
    let start = Instant::now();
    let addr = format!("{}:{}", host, port);
    while start.elapsed() < Duration::from_secs(timeout_secs) {
        if TcpStream::connect(&addr).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

/// 发送一个最小 HTTP GET，只判断有没有响应（不管状态码）。
/// 端口通了但 Next 还没编译完时，连接会立刻被拒，用它来区分这两种状态。
fn probe_http(url: &str) -> Option<bool> {
    use std::io::{Read, Write};
    let rest = url.strip_prefix("http://")?;
    let (hostport, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let mut s = TcpStream::connect(hostport).ok()?;
    s.set_read_timeout(Some(Duration::from_millis(1500))).ok()?;
    s.set_write_timeout(Some(Duration::from_millis(1500))).ok()?;
    let req = format!(
        "GET {} HTTP/1.0\r\nHost: {}\r\nConnection: close\r\n\r\n",
        path, hostport
    );
    s.write_all(req.as_bytes()).ok()?;
    let mut buf = [0u8; 256];
    let n = s.read(&mut buf).ok()?;
    Some(n > 0)
}

/// 查找 standalone 目录
/// - Release 模式（打包后）：resource_dir/_up_/.next/standalone/
///   Tauri 把 resources: ["../.next/standalone/**/*"] 打包时，
///   "../" 会变成 "_up_" 目录，所以实际路径是 _up_/.next/standalone/
/// - Dev 模式：不需要（dev 模式不启动 sidecar）
fn find_standalone_dir(app: &tauri::App) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;

    // 打包后的实际路径：resource_dir/_up_/.next/standalone/
    let packaged = resource_dir.join("_up_").join(".next").join("standalone");
    if packaged.join("sidecar-info.json").exists() {
        return Some(packaged);
    }

    // 兜底：resource_dir/standalone/（以防 Tauri 改了打包行为）
    let direct = resource_dir.join("standalone");
    if direct.join("sidecar-info.json").exists() {
        return Some(direct);
    }

    None
}

/// 调试日志：同时输出到 stdout 和文件，窗口闪退时也能抓到原因
fn dbg_log(msg: &str) {
    // 带时间戳，方便看出事件间隔（比如"启动后 3 秒就退出"）
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!("[{}] {}", secs % 100000, msg);
    println!("{}", line);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("E:\\Amadeus\\amadeus-startup.log")
    {
        use std::io::Write;
        let _ = writeln!(f, "{}", line);
    }
}

/// 清理 WebView2 缓存。
///
/// 每次 build 都会生成新文件名的 chunk，旧缓存里的引用会 404，
/// WebView 会显示 "This page couldn't load"。
/// 这里在检测到 build 变化时自动清一次，用户无感知。
fn clear_webview_cache_if_stale(app: &tauri::App) {
    // 用 build 产物的 BUILD_ID 作为版本标记
    let standalone_dir = match find_standalone_dir(app) {
        Some(d) => d,
        None => return,
    };
    let build_id_path = standalone_dir.join("amadeus").join(".next").join("BUILD_ID");
    let current_id = match std::fs::read_to_string(&build_id_path) {
        Ok(s) => s.trim().to_string(),
        Err(_) => return,
    };
    if current_id.is_empty() {
        return;
    }

    // WebView2 数据目录固定为 %LOCALAPPDATA%\<identifier>\EBWebView
    let cache_dir = match std::env::var("LOCALAPPDATA") {
        Ok(base) => std::path::PathBuf::from(base)
            .join("com.amadeus.kurisu")
            .join("EBWebView"),
        Err(_) => return,
    };
    if !cache_dir.exists() {
        return;
    }

    // 版本标记写在 EBWebView 同级的隐藏文件里
    let stamp_file = cache_dir.join("..").join(".amadeus_build_id");
    let last_id = std::fs::read_to_string(&stamp_file).unwrap_or_default();
    if last_id.trim() == current_id {
        return; // 版本没变，不用清
    }

    dbg_log(&format!("[Amadeus] build 版本变化 ({})，清理 WebView 缓存", current_id));

    // 清缓存：只删网页内容相关目录，保留 Local Storage（登录态、设置）
    for sub in ["Default\\Cache", "Default\\Code Cache", "Default\\GPUCache", "Cache", "Code Cache"] {
        let p = cache_dir.join(sub);
        if p.exists() {
            let _ = std::fs::remove_dir_all(&p);
        }
    }
    // 写入新的版本标记
    if let Some(parent) = stamp_file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&stamp_file, &current_id);
    dbg_log("[Amadeus] WebView 缓存已清理");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// 拖动窗口（无边框窗口的自绘拖动条用）。
///
/// 为什么不用 Tauri 自带的 `data-tauri-drag-region`：
///   实测（2026-10-25）在 `decorations: false` + `resizable: false` 的窗口上，
///   那个属性的内置脚本没有生效 —— DOM 检查确认拖动条没被遮挡（elementFromPoint
///   命中的就是它自己、z-index 25、pointer-events auto），但按住拖不动。
///   所以改成自己发 Win32 消息，行为 100% 可控。
///
/// 原理就是经典的「假装按住了标题栏」：
///   ReleaseCapture() 释放当前鼠标捕获，
///   SendMessage(WM_NCLBUTTONDOWN, HTCAPTION) 让系统进入拖动窗口的循环。
/// SendMessage 会一直阻塞到这个拖动结束，所以该命令会在 IPC 线程上停留一会儿，
/// 这是正常现象。
#[tauri::command]
fn start_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SendMessageW, HTCAPTION, WM_NCLBUTTONDOWN,
        };
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let h = hwnd.0 as *mut core::ffi::c_void;
        unsafe {
            ReleaseCapture();
            SendMessageW(h, WM_NCLBUTTONDOWN, HTCAPTION as usize, 0);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        window.start_dragging().map_err(|e| e.to_string())
    }
}

/// 最小化到任务栏。
/// 无边框窗口没有系统标题栏，最小化按钮由前端自绘，点击后调用这个命令。
#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// 隐藏到系统托盘（2026-10-25 新增）。
/// 关闭弹窗里的「最小化」选项用这个：窗口从屏幕和任务栏都消失，
/// 只剩右下角托盘图标 —— 跟顶栏「—」的最小化（任务栏保留按钮）区分开。
/// 托盘图标单击/双击会把它弹回来（见 on_tray_icon_event）。
#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// 真正退出应用（前端"退出软件"按钮确认后调用）。
///
/// 为什么不能直接 window.close()：
///   主窗口的 CloseRequested 被拦成「隐藏到系统托盘」（见 on_window_event），
///   那是点旧版标题栏叉号的行为。用户明确选"退出"时要的是**进程结束**，
///   所以这里手动清 sidecar + 语音服务，再 exit(0)。
/// 不杀 sidecar 的话，node 进程会残留占着 3456 端口（踩过好几次）。
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    use tauri::Manager;
    {
        let state = app.state::<AppState>();
        // 注意：这里必须把 lock 的结果绑定成变量再 if let，
        // 写成 `if let Ok(guard) = state.lock()` 会让临时 MutexGuard 活得比
        // state 更久，rustc 报 E0597（借用值提前析构）。
        let mut guard = state.node_process.lock().unwrap();
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
            dbg_log("[Amadeus] Node.js sidecar 已终止（退出应用）");
        }
    }
    dbg_log("[Amadeus] 用户确认退出，进程结束");
    // 2026-10-25 实测：这里**不能**用 app.exit(0)。
    // app.exit 会先走关窗口流程，而主窗口的 CloseRequested 被 on_window_event
    // 拦成「隐藏到系统托盘」并调了 api.prevent_close() —— 退出流程卡在那里，
    // 前端看到的就是按钮一直停在"退出中..."、窗口也不消失。
    // 所以清理完直接结束进程（sidecar / 语音服务上面已经手动处理过）。
    std::process::exit(0);
}

pub fn run() {
    tauri::Builder::default()
        // 单实例插件：必须是第一个注册的插件。
        // 第二次启动 app.exe 时不会开新窗口/新 sidecar，而是退出并把已有窗口带到前台。
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        // tauri-plugin-fs 已移除（2026-10-12）：原用于 image-store.ts 存图片，
        // 该文件在死代码清理时删除，相关权限也从 capabilities/default.json 移除。
        .manage(AppState {
            node_process: Mutex::new(None),
        })
        // 前端自绘标题栏用到的命令（2026-10-25 无边框窗口）
        .invoke_handler(tauri::generate_handler![
            minimize_window,
            hide_window,
            quit_app,
            start_drag
        ])
        .setup(|app| {
            dbg_log("[Amadeus] ===== 启动 =====");
            dbg_log("[Amadeus] 启动中...");

            // build 变了就清 WebView 缓存，避免旧 chunk 导致页面白屏
            clear_webview_cache_if_stale(app);

            // Dev 模式（debug_assertions）：Next.js server 由 beforeDevCommand 启动，
            // 窗口直接加载 localhost:3000，不启动 sidecar。
            // Release 模式：启动 Node.js sidecar，窗口加载 localhost:3456。
            let server_url = if cfg!(debug_assertions) {
                dbg_log("[Amadeus] 开发模式：加载 http://localhost:3000");
                "http://localhost:3000".to_string()
            } else {
                // Release 模式：启动 sidecar
                let standalone_dir = find_standalone_dir(app).expect(
                    "找不到 standalone 目录。安装包可能损坏，请重新安装。"
                );
                dbg_log(&format!("[Amadeus] standalone 目录: {:?}", standalone_dir));

                let info_str = std::fs::read_to_string(standalone_dir.join("sidecar-info.json"))
                    .expect("无法读取 sidecar-info.json");
                let info: SidecarInfo = serde_json::from_str(&info_str)
                    .expect("sidecar-info.json 格式错误");
                dbg_log(&format!("[Amadeus] 服务地址: {}", info.url));

                // 启动 Node.js sidecar（隐藏控制台窗口）
                let node_path = standalone_dir.join(&info.node_exe);
                let start_script = standalone_dir.join(&info.start_script);
                dbg_log(&format!("[Amadeus] 启动 Node.js sidecar: {:?} {:?}", node_path, start_script));

                let mut cmd = Command::new(&node_path);
                cmd.arg(&start_script);
                cmd.current_dir(&standalone_dir);
                #[cfg(windows)]
                {
                    cmd.creation_flags(CREATE_NO_WINDOW);
                }
                let child = cmd.spawn().expect("启动 Node.js sidecar 失败");

                let state: tauri::State<AppState> = app.state();
                *state.node_process.lock().unwrap() = Some(child);

                // 等待端口可用
                dbg_log("[Amadeus] 等待 Next.js server 就绪...");
                if !wait_for_port(&info.host, info.port, 30) {
                    eprintln!("[Amadeus] 错误：Next.js server 30 秒内未就绪");
                    return Err(Box::new(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "Next.js server 启动超时",
                    )));
                }
                dbg_log("[Amadeus] Next.js server 已就绪！");
                // 端口通了不代表 Next 的首次编译完成。
                // 实测等 1.5 秒还不够（页面会显示 This page couldn't load），
                // 这里循环探测首页，直到真的能拿到 HTTP 响应再开窗口。
                for i in 1..=20 {
                    std::thread::sleep(Duration::from_millis(500));
                    if probe_http(&format!("http://{}:{}", info.host, info.port)).unwrap_or(false) {
                        dbg_log(&format!("[Amadeus] 首页就绪（第 {} 次探测，约 {} 秒）", i, i / 2));
                        break;
                    }
                    if i == 20 {
                        dbg_log("[Amadeus] 警告：首页探测 10 秒仍未响应，仍继续开窗口");
                    }
                }
                info.url
            };

            // 创建主窗口
            let url: String = server_url.clone();
            // 页面加载完注入探测脚本：渲染异常则自动重载。
            // Tauri 2.x 的 on_page_load 只给 Started/Finished，没有错误事件，
            // 所以用"加载完后检查 DOM 是否为空"来判断失败。
            let main_window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
                .title("Amadeus")
                // 2026-10-25：改成**无边框窗口**（用户要求"纯净"，不要系统标题栏）。
                // 标题栏和最小化/关闭按钮由前端自绘（src/components/WindowBar.tsx），
                // 所以窗口尺寸从此固定 1280×720，既不能拖边框改大小，也不提供最大化。
                //
                // 无边框后客户区正好等于 inner_size（不再被标题栏吃掉高度），
                // 前端 1280 宽的设计基准 → 根字号 100vw/80 = 16px，比例精确。
                .inner_size(1280.0, 720.0)
                .min_inner_size(1280.0, 720.0)
                .max_inner_size(1280.0, 720.0)
                .center()
                .decorations(false)
                .resizable(false)
                // 无边框后整个客户区都是网页，页面首帧渲染前会露出 webview 默认白底，
                // 视觉上就是"开窗闪一下白"。设成黑色和界面背景一致，启动更平滑。
                .background_color(tauri::window::Color(0, 0, 0, 255))
                .on_page_load(|window, payload| {
                    use tauri::webview::PageLoadEvent;
                    if matches!(payload.event(), PageLoadEvent::Finished) {
                        let script = r#"
                            (function(){
                                if (window.__amadeusWatch) { clearInterval(window.__amadeusWatch); }
                                var tries = 0;
                                window.__amadeusWatch = setInterval(function(){
                                    tries++;
                                    var root = document.getElementById('__next') || document.body;
                                    var broken = !root || root.children.length === 0;
                                    if (broken && tries < 10) {
                                        clearInterval(window.__amadeusWatch);
                                        console.warn('[amadeus] 页面渲染异常，正在重载', tries);
                                        setTimeout(function(){ window.location.reload(); }, 1500);
                                    } else if (!broken) {
                                        clearInterval(window.__amadeusWatch);
                                    }
                                }, 800);
                            })();
                        "#;
                        let _ = window.eval(script);
                    }
                })
                .build()?;

            // 窗口建好后装上尺寸约束：禁止拖边框改大小，
            // 只保留「初始窗口尺寸」和「全屏（最大化）」两种状态
            #[cfg(windows)]
            {
                match main_window.hwnd() {
                    Ok(h) => window_aspect::lock_size(h.0 as *mut core::ffi::c_void),
                    Err(e) => eprintln!("[window] 取窗口句柄失败，跳过尺寸约束: {e}"),
                }
            }

            dbg_log(&format!("[Amadeus] 应用窗口已创建，加载: {}", server_url));

            // 创建系统托盘（点叉号隐藏到托盘，托盘菜单提供退出）
            let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 Amadeus", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            dbg_log("[Amadeus] 创建托盘图标...");

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Amadeus")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                // 同 2026-10-25 修复：最小化状态下 show() 不会解除最小化
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            // 杀 sidecar 后退出
                            let state: tauri::State<AppState> = app.state();
                            let mut guard = state.node_process.lock().unwrap();
                            if let Some(mut child) = guard.take() {
                                let _ = child.kill();
                                let _ = child.wait();
                                dbg_log("[Amadeus] Node.js sidecar 已终止");
                            }
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        match event {
                            // 2026-10-25 第三次修：托盘点击**只弹回前台，永不隐藏**。
                            // 之前是"可见就隐藏"的开关逻辑，双击会产生
                            // Click(显示)→Click(隐藏)→DoubleClick(显示) 的序列，
                            // 窗口一闪一闪还可能停在隐藏态（用户实测）。
                            // 隐藏走 ✕ 弹窗的「最小化」（主动操作），托盘只负责弹出。
                            TrayIconEvent::Click { button: MouseButton::Left, .. } => {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                            TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                            _ => {}
                        }
                    }
                })
                .build(app)?;

            dbg_log("[Amadeus] setup 完成，进入事件循环");
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // 点叉号不退出，隐藏到系统托盘
                    dbg_log("[Amadeus] 最小化到系统托盘");
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| match event {
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                dbg_log(&format!("[Amadeus] ExitRequested code={:?}（准备退出）", code));
                            let _ = api;
            }
            tauri::RunEvent::Exit => {
                dbg_log("[Amadeus] Exit 事件：进程即将结束");
                        }
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } => {
                dbg_log(&format!("[Amadeus] 窗口被销毁: {}", label));
            }
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { .. }, .. } => {
                dbg_log(&format!("[Amadeus] 窗口请求关闭: {}", label));
            }
            _ => {}
        });
}
