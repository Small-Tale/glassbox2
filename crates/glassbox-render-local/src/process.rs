use std::io;
use std::process::Command;
use std::time::{Duration, Instant};

pub fn run(mut command: Command, timeout: Duration) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    #[cfg(windows)]
    let job = windows::Job::new()?;

    let mut child = command.spawn()?;
    #[cfg(windows)]
    if let Err(error) = job.assign(&child) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }

    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait()? {
            return if status.success() {
                Ok(())
            } else {
                Err(io::Error::other("Renderer exited unsuccessfully"))
            };
        }
        if Instant::now() >= deadline {
            #[cfg(unix)]
            {
                // The child started a fresh process group. A negative PID targets that group.
                unsafe { libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL) };
            }
            #[cfg(windows)]
            drop(job);
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Renderer timed out",
            ));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(windows)]
mod windows {
    use std::io;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use std::ptr::null;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };

    pub struct Job(HANDLE);

    impl Job {
        pub fn new() -> io::Result<Self> {
            // The process owns this non-inherited job handle until Drop.
            let handle = unsafe { CreateJobObjectW(null(), null()) };
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            let job = Self(handle);
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let result = unsafe {
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if result == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(job)
        }

        pub fn assign(&self, child: &Child) -> io::Result<()> {
            // The child owns its process handle and remains live throughout the call.
            let result = unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle()) };
            if result == 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(())
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // Closing the last job handle terminates any remaining members.
            unsafe { CloseHandle(self.0) };
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn timeout_stops_the_tool_and_its_child() {
        let scratch = tempfile::tempdir().unwrap();
        let marker = scratch.path().join("marker");
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "( sleep 0.4; touch \"$1\" ) & wait", "fixture"])
            .arg(&marker);
        let failure = run(command, Duration::from_millis(80)).unwrap_err();
        assert_eq!(failure.kind(), io::ErrorKind::TimedOut);
        std::thread::sleep(Duration::from_millis(450));
        assert!(!marker.exists());
    }
}
