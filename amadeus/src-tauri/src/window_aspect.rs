//! 窗口尺寸约束（Windows 专用，2026-10-25）
//!
//! 需求演进：
//!   1. 最初：窗口能随意拖成任意形状 → 界面比例乱
//!   2. 中间：WM_SIZING 锁成 16:9 → 拖动时画面抖
//!   3. 再后来：只留「窗口 / 全屏」两档 → 全屏切换会闪
//!   4. 现在（用户拍板）：**去掉全屏功能，窗口固定 1280×720**，
//!      并且窗口本身改成无边框（decorations = false），
//!      标题栏 / 最小化 / 关闭全部由前端自绘（src/components/WindowBar.tsx）。
//!
//! 为什么还要这段消息拦截：
//!   `resizable(false)` 只挡住了鼠标拖边框。**键盘 Win+↑ 和 Alt+Space 菜单里的
//!   "最大化"仍能触发 SC_MAXIMIZE** —— 一旦最大化，固定尺寸就破了，
//!   前端 1280 宽的设计基准也就不成立了。所以这里在消息层把 SC_MAXIMIZE
//!   和 SC_SIZE 直接吞掉（SC_MINIMIZE 放行，最小化按钮要能用）。

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;

const WM_SIZING: u32 = 0x0214;
const WM_NCHITTEST: u32 = 0x0084;
const WM_SYSCOMMAND: u32 = 0x0112;

/// 系统菜单命令（低 4 位是系统保留的，比较高 12 位才准确）
const SC_MASK: usize = 0xFFF0;
const SC_SIZE: usize = 0xF000;
const SC_MAXIMIZE: usize = 0xF030;

/// HTLEFT(10) ~ HTBOTTOMRIGHT(17)：系统认为"这里是可拖拽的边框"
const HT_FIRST_RESIZE: isize = 10;
const HT_LAST_RESIZE: isize = 17;
/// HTCLIENT(1)：普通客户区
const HTCLIENT: isize = 1;

/// 给窗口装上「尺寸锁死」约束。
/// 装失败只打日志，绝不影响 app 启动。
pub fn lock_size(hwnd: HWND) {
    // 子类 ID 随便取个不重复的值（0x416D64 = "Amd"）
    let ok = unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), 0x416D64, 0) };
    if ok == 0 {
        eprintln!("[window] 尺寸约束安装失败，窗口可能被最大化");
    } else {
        println!("[window] 已锁定窗口尺寸（固定 1280x720，无边框）");
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uid: usize,
    _refdata: usize,
) -> LRESULT {
    if msg == WM_SYSCOMMAND {
        // Win+↑ / Alt+Space → 最大化：直接吞掉，不交给系统处理。
        // SC_SIZE 是键盘发起的"调整大小"，同样禁掉。
        let cmd = wparam & SC_MASK;
        if cmd == SC_MAXIMIZE || cmd == SC_SIZE {
            return 0;
        }
    }

    if msg == WM_NCHITTEST {
        // 无边框窗口理论上没有可拖拽边框了，这里是兜底：
        // 万一某些 Windows 版本仍把边缘判定成 ThickFrame，光标会变成双向箭头，
        // 但拖了又没反应（尺寸锁死），体验很怪。统一改写成普通客户区。
        let hit = DefSubclassProc(hwnd, msg, wparam, lparam);
        if (HT_FIRST_RESIZE..=HT_LAST_RESIZE).contains(&hit) {
            return HTCLIENT;
        }
        return hit;
    }

    if msg == WM_SIZING {
        // 兜底：万一还有路径能进拖拽调整，把目标矩形改回当前矩形。
        let target = lparam as *mut RECT;
        if !target.is_null() {
            let mut current: RECT = std::mem::zeroed();
            if GetWindowRect(hwnd, &mut current) != 0 {
                *target = current;
            }
        }
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}
