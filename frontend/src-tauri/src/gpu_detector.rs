use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DriverStatus {
    Available,
    Missing,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    /// Whether any GPU capable of acceleration was detected.
    pub detected: bool,
    /// Human-readable GPU name, e.g. "NVIDIA RTX 3060".
    pub name: Option<String>,
    /// True if the GPU vendor is known to support Ollama acceleration
    /// (NVIDIA with CUDA, AMD with ROCm, or Apple Silicon with Metal).
    pub acceleration_likely: bool,
    /// Driver availability assessment.
    pub driver_status: DriverStatus,
    /// Human-readable status message suitable for the UI.
    pub display_message: String,
}

impl Default for GpuInfo {
    fn default() -> Self {
        Self {
            detected: false,
            name: None,
            acceleration_likely: false,
            driver_status: DriverStatus::Unknown,
            display_message: "Running in CPU mode. GPU acceleration is optional and only enhances performance.".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

pub struct GpuDetector;

impl GpuDetector {
    /// Run platform-specific GPU detection.
    /// This is informational only -- Ollama handles GPU internally.
    pub fn detect() -> GpuInfo {
        #[cfg(target_os = "windows")]
        {
            Self::detect_windows()
        }
        #[cfg(target_os = "macos")]
        {
            Self::detect_macos()
        }
        #[cfg(target_os = "linux")]
        {
            Self::detect_linux()
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            GpuInfo::default()
        }
    }

    #[cfg(target_os = "windows")]
    fn detect_windows() -> GpuInfo {
        // Use powershell to query GPU information because wmic is deprecated in Win 11
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"])
            .output();

        match output {
            Ok(out) if out.status.success() => {
                let text = String::from_utf8_lossy(&out.stdout).to_string();
                let mut best_gpu_name = String::new();
                let mut is_nvidia = false;
                let mut is_amd = false;

                // Evaluate all lines, prefer NVIDIA or AMD over Intel
                for line in text.lines() {
                    let l = line.trim();
                    if l.is_empty() {
                        continue;
                    }
                    let upper = l.to_uppercase();
                    let current_is_nvidia = upper.contains("NVIDIA");
                    let current_is_amd = upper.contains("AMD") || upper.contains("RADEON");

                    if current_is_nvidia || current_is_amd {
                        best_gpu_name = l.to_string();
                        is_nvidia = current_is_nvidia;
                        is_amd = current_is_amd;
                        // Dedicated GPU found, we can stop searching
                        break;
                    } else if best_gpu_name.is_empty() {
                        // Keep Integrated/fallback GPU if no dedicated found yet
                        best_gpu_name = l.to_string();
                    }
                }

                if best_gpu_name.is_empty() {
                    return GpuInfo::default();
                }

                let acceleration_likely = is_nvidia || is_amd;

                // Check for NVIDIA driver specifically
                let driver_status = if is_nvidia {
                    if Self::check_nvidia_smi_windows() {
                        DriverStatus::Available
                    } else {
                        DriverStatus::Missing
                    }
                } else if is_amd {
                    DriverStatus::Unknown // ROCm detection is complex on Windows
                } else {
                    DriverStatus::Unknown
                };

                let display_message = match (&driver_status, acceleration_likely) {
                    (DriverStatus::Available, true) => {
                        format!("GPU acceleration available: {}", best_gpu_name)
                    }
                    (DriverStatus::Missing, true) => {
                        format!(
                            "GPU detected: {}. Install drivers for faster AI performance.",
                            best_gpu_name
                        )
                    }
                    _ => {
                        "Running in CPU mode. GPU acceleration is optional and only enhances performance.".to_string()
                    }
                };

                GpuInfo {
                    detected: true,
                    name: Some(best_gpu_name),
                    acceleration_likely,
                    driver_status,
                    display_message,
                }
            }
            _ => {
                log::warn!("GPU detection via PowerShell failed");
                GpuInfo::default()
            }
        }
    }

    #[cfg(target_os = "windows")]
    fn check_nvidia_smi_windows() -> bool {
        std::process::Command::new("nvidia-smi")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[cfg(target_os = "macos")]
    fn detect_macos() -> GpuInfo {
        // On macOS, check for Apple Silicon (M1/M2/M3) which supports Metal
        let output = std::process::Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output();

        match output {
            Ok(out) if out.status.success() => {
                let cpu_brand = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let is_apple_silicon = cpu_brand.contains("Apple");

                if is_apple_silicon {
                    GpuInfo {
                        detected: true,
                        name: Some(format!("{} (Metal)", cpu_brand)),
                        acceleration_likely: true,
                        driver_status: DriverStatus::Available,
                        display_message: format!(
                            "GPU acceleration active: {} via Metal",
                            cpu_brand
                        ),
                    }
                } else {
                    // Intel Mac -- no Metal GPU for Ollama
                    GpuInfo {
                        detected: false,
                        name: None,
                        acceleration_likely: false,
                        driver_status: DriverStatus::Unknown,
                        display_message: "Running in CPU mode. GPU acceleration is optional and only enhances performance.".to_string(),
                    }
                }
            }
            _ => GpuInfo::default(),
        }
    }

    #[cfg(target_os = "linux")]
    fn detect_linux() -> GpuInfo {
        // Check lspci for GPU
        let output = std::process::Command::new("lspci")
            .output();

        let gpu_name = match &output {
            Ok(out) if out.status.success() => {
                let text = String::from_utf8_lossy(&out.stdout);
                text.lines()
                    .find(|l| {
                        let upper = l.to_uppercase();
                        upper.contains("VGA") || upper.contains("3D") || upper.contains("DISPLAY")
                    })
                    .map(|l| {
                        // Extract the device name after the colon
                        l.split(':').last().unwrap_or(l).trim().to_string()
                    })
            }
            _ => None,
        };

        if let Some(ref name) = gpu_name {
            let upper = name.to_uppercase();
            let is_nvidia = upper.contains("NVIDIA");
            let is_amd = upper.contains("AMD") || upper.contains("RADEON");
            let acceleration_likely = is_nvidia || is_amd;

            let driver_status = if is_nvidia {
                if Self::check_nvidia_smi_linux() {
                    DriverStatus::Available
                } else {
                    DriverStatus::Missing
                }
            } else if is_amd {
                DriverStatus::Unknown
            } else {
                DriverStatus::Unknown
            };

            let display_message = match (&driver_status, acceleration_likely) {
                (DriverStatus::Available, true) => {
                    format!("GPU acceleration available: {}", name)
                }
                (DriverStatus::Missing, true) => {
                    format!(
                        "GPU detected: {}. Install drivers for faster AI performance.",
                        name
                    )
                }
                _ => {
                    "Running in CPU mode. GPU acceleration is optional and only enhances performance.".to_string()
                }
            };

            GpuInfo {
                detected: true,
                name: gpu_name,
                acceleration_likely,
                driver_status,
                display_message,
            }
        } else {
            GpuInfo::default()
        }
    }

    #[cfg(target_os = "linux")]
    fn check_nvidia_smi_linux() -> bool {
        std::process::Command::new("nvidia-smi")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}
