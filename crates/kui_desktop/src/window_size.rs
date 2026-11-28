use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

const SCREEN_FRACTION: f64 = 0.9;

/// Physical pixels of the monitor area not covered by the menu bar, Dock or taskbar.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    pub position: PhysicalPosition<i32>,
    pub size: PhysicalSize<u32>,
}

/// Centres a window covering `SCREEN_FRACTION` of `area`, never smaller than `min` unless the
/// screen itself is smaller.
pub fn placement(area: WorkArea, min: PhysicalSize<u32>) -> Placement {
    let side = |available: u32, min: u32| {
        let target = (f64::from(available) * SCREEN_FRACTION).round() as u32;
        target.max(min).min(available)
    };
    let width = side(area.width, min.width);
    let height = side(area.height, min.height);
    let offset = |available: u32, used: u32| i32::try_from((available - used) / 2).unwrap_or(0);
    Placement {
        position: PhysicalPosition::new(area.x + offset(area.width, width), area.y + offset(area.height, height)),
        size: PhysicalSize::new(width, height),
    }
}

/// Sizes `window` to its monitor, then shows it. The window starts hidden (see tauri.conf.json) so
/// it never flashes at the configured fallback size; it is shown even if sizing fails.
pub fn fit_to_monitor(window: &WebviewWindow, min_logical: (f64, f64)) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let rect = monitor.work_area();
        let area =
            WorkArea { x: rect.position.x, y: rect.position.y, width: rect.size.width, height: rect.size.height };
        let scale = monitor.scale_factor();
        let min = PhysicalSize::new((min_logical.0 * scale) as u32, (min_logical.1 * scale) as u32);
        let Placement { position, size } = placement(area, min);
        let _ = window.set_size(size);
        let _ = window.set_position(position);
    }
    let _ = window.show();
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: PhysicalSize<u32> = PhysicalSize { width: 960, height: 600 };

    #[test]
    fn covers_ninety_percent_centred_in_the_work_area() {
        let area = WorkArea { x: 0, y: 50, width: 2000, height: 1000 };
        let p = placement(area, MIN);
        assert_eq!(p.size, PhysicalSize::new(1800, 900));
        assert_eq!(p.position, PhysicalPosition::new(100, 100));
    }

    #[test]
    fn respects_the_minimum_size_on_small_screens() {
        let area = WorkArea { x: 0, y: 0, width: 1000, height: 650 };
        assert_eq!(placement(area, MIN).size, PhysicalSize::new(960, 600));
    }

    #[test]
    fn never_exceeds_a_screen_smaller_than_the_minimum() {
        let area = WorkArea { x: 10, y: 0, width: 800, height: 500 };
        let p = placement(area, MIN);
        assert_eq!(p.size, PhysicalSize::new(800, 500));
        assert_eq!(p.position, PhysicalPosition::new(10, 0));
    }

    #[test]
    fn keeps_secondary_monitor_offsets() {
        let area = WorkArea { x: -1920, y: 0, width: 1920, height: 1080 };
        assert_eq!(placement(area, MIN).position, PhysicalPosition::new(-1824, 54));
    }
}
