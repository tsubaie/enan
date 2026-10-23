//go:build !linux

package updater

import "context"

// watch is Linux only (inotify); elsewhere Run polls the commands folder.
func watch(context.Context, string) <-chan struct{} { return nil }
