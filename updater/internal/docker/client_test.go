package docker

import (
	"bytes"
	"encoding/binary"
	"testing"
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
