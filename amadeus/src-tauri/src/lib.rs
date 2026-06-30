use std::process::{Command, Child};
use std::sync::Mutex;
use std::net::TcpStream;
use std::time::{Duration, Instant};
use std::path::PathBuf;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

/// 轮询端口直到可用，最多等 timeout_secs 秒
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            node_process: Mutex::new(None),
        })
        .setup(|app| {
            println!("[Amadeus] 启动中...");

            // Dev 模式（debug_assertions）：Next.js server 由 beforeDevCommand 启动，
            // 窗口直接加载 localhost:3000，不启动 sidecar。
            // Release 模式：启动 Node.js sidecar，窗口加载 localhost:3456。
            let server_url = if cfg!(debug_assertions) {
                println!("[Amadeus] 开发模式：加载 http://localhost:3000");
                "http://localhost:3000".to_string()
            } else {
                // Release 模式：启动 sidecar
                let standalone_dir = find_standalone_dir(app).expect(
                    "找不到 standalone 目录。安装包可能损坏，请重新安装。"
                );
                println!("[Amadeus] standalone 目录: {:?}", standalone_dir);

                let info_str = std::fs::read_to_string(standalone_dir.join("sidecar-info.json"))
                    .expect("无法读取 sidecar-info.json");
                let info: SidecarInfo = serde_json::from_str(&info_str)
                    .expect("sidecar-info.json 格式错误");
                println!("[Amadeus] 服务地址: {}", info.url);

                // 启动 Node.js sidecar（隐藏控制台窗口）
                let node_path = standalone_dir.join(&info.node_exe);
                let start_script = standalone_dir.join(&info.start_script);
                println!("[Amadeus] 启动 Node.js sidecar: {:?} {:?}", node_path, start_script);

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
                println!("[Amadeus] 等待 Next.js server 就绪...");
                if !wait_for_port(&info.host, info.port, 30) {
                    eprintln!("[Amadeus] 错误：Next.js server 30 秒内未就绪");
                    return Err(Box::new(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "Next.js server 启动超时",
                    )));
                }
                println!("[Amadeus] Next.js server 已就绪！");
                info.url
            };

            // 创建主窗口
            let url: String = server_url.clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
                .title("Amadeus")
                .inner_size(1280.0, 800.0)
                .min_inner_size(800.0, 600.0)
                .center()
                .resizable(true)
                .build()?;

            println!("[Amadeus] 应用窗口已创建，加载: {}", server_url);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    println!("[Amadeus] 主窗口关闭，清理 sidecar");
                    let app = window.app_handle();
                    let state: tauri::State<AppState> = app.state();
                    let mut guard = state.node_process.lock().unwrap();
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                        println!("[Amadeus] Node.js sidecar 已终止");
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                println!("[Amadeus] 应用退出");
            }
        });
}
