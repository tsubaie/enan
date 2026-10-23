package updater

import (
	"context"
	"os"
	"syscall"
)

// watch wakes the run loop when a file is renamed or written into dir: Enan and the CLI leave a
// command under a temporary name and rename it (ADMIN-B58), so a command is acted on at once,
// with no polling. It returns nil when the system cannot watch the folder; Run then polls.
func watch(ctx context.Context, dir string) <-chan struct{} {
	fd, err := syscall.InotifyInit1(syscall.IN_CLOEXEC | syscall.IN_NONBLOCK)
	if err != nil {
		return nil
	}
	if _, err := syscall.InotifyAddWatch(fd, dir, syscall.IN_MOVED_TO|syscall.IN_CLOSE_WRITE); err != nil {
		syscall.Close(fd)
		return nil
	}
	// A non-blocking fd goes to Go's poller, so Close interrupts a Read already waiting on it.
	events := os.NewFile(uintptr(fd), "inotify")
	wake := make(chan struct{}, 1)
	go func() {
		<-ctx.Done()
		events.Close()
	}()
	go func() {
		buffer := make([]byte, 4096)
		for {
			if n, err := events.Read(buffer); err != nil || n <= 0 {
				return
			}
			select {
			case wake <- struct{}{}:
			default: // a wake is already pending; the loop reads every command when it runs
			}
		}
	}()
	return wake
}
