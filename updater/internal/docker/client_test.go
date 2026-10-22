package docker

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func frame(stream byte, text string) []byte {
	header := make([]byte, 8)
	header[0] = stream
	binary.BigEndian.PutUint32(header[4:], uint32(len(text)))
	return append(header, text...)
}

func TestDemux(t *testing.T) {
	stream := append(frame(1, "out "), frame(2, "err\n")...)
	if got, err := demux(bytes.NewReader(stream)); err != nil || got != "out err\n" {
		t.Fatalf("%q, %v", got, err)
	}
	// A container with a TTY sends a plain stream.
	if got, _ := demux(bytes.NewReader([]byte("plain text output"))); got != "plain text output" {
		t.Fatalf("%q", got)
	}
	if got, err := demux(bytes.NewReader(nil)); err != nil || got != "" {
		t.Fatalf("%q, %v", got, err)
	}
}

// serve answers on a Unix socket as the daemon would; a handler may also never answer.
func serve(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	dir, err := os.MkdirTemp("", "dk") // short: a socket path is limited to about 100 bytes
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	socket := filepath.Join(dir, "d.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: handler}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close() })
	return New(socket)
}

func TestADMINB56ADaemonThatNeverAnswersTimesOut(t *testing.T) {
	short, long := callTimeout, longTimeout
	callTimeout, longTimeout = 50*time.Millisecond, 80*time.Millisecond
	t.Cleanup(func() { callTimeout, longTimeout = short, long })
	client := serve(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/"+Version+"/containers/ok/json" {
			w.Write([]byte(`{"Id":"ok","Name":"/enan-app-1"}`))
			return
		}
		<-r.Context().Done()
	})
	if container, err := client.InspectContainer(context.Background(), "ok"); err != nil || container.ID != "ok" {
		t.Fatalf("an answered call: %v %v", container, err)
	}
	for name, call := range map[string]func() error{
		"inspect": func() error { _, err := client.InspectContainer(context.Background(), "stuck"); return err },
		"pull":    func() error { return client.Pull(context.Background(), "ghcr.io/x/y", "sha256:z") },
		"exec":    func() error { _, _, err := client.Exec(context.Background(), "app", []string{"true"}); return err },
	} {
		started := time.Now()
		if err := call(); !errors.Is(err, context.DeadlineExceeded) || time.Since(started) > 5*time.Second {
			t.Fatalf("%s: %v after %s", name, err, time.Since(started))
		}
	}
}
