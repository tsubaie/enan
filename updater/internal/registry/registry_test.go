package registry

import (
	"context"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
)

func TestParse(t *testing.T) {
	cases := map[string]Reference{
		"ghcr.io/tsubaie/enan:edge": {Host: "ghcr.io", Path: "tsubaie/enan", Tag: "edge", Repository: "ghcr.io/tsubaie/enan"},
		"ghcr.io/tsubaie/enan":      {Host: "ghcr.io", Path: "tsubaie/enan", Tag: "latest", Repository: "ghcr.io/tsubaie/enan"},
		"localhost:5000/enan:1":     {Host: "localhost:5000", Path: "enan", Tag: "1", Repository: "localhost:5000/enan"},
		"busybox:1.37":              {Host: "registry-1.docker.io", Path: "library/busybox", Tag: "1.37", Repository: "busybox"},
		"someone/enan:0.2":          {Host: "registry-1.docker.io", Path: "someone/enan", Tag: "0.2", Repository: "someone/enan"},
	}
	for ref, want := range cases {
		if got, err := Parse(ref); err != nil || got != want {
			t.Fatalf("Parse(%q) = %+v, %v", ref, got, err)
		}
	}
	if _, err := Parse("ghcr.io/tsubaie/enan@sha256:abc"); err == nil {
		t.Fatal("a digest reference has no tag to follow")
	}
}

// A registry that asks for an anonymous token first, as GHCR does.
func TestDigestAnswersTheTokenChallenge(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/token":
			if r.URL.Query().Get("scope") != "repository:tsubaie/enan:pull" {
				http.Error(w, "bad scope", http.StatusBadRequest)
				return
			}
			w.Write([]byte(`{"token":"anonymous"}`))
		case r.Header.Get("Authorization") != "Bearer anonymous":
			w.Header().Set("WWW-Authenticate", `Bearer realm="`+server.URL+`/token",service="test",scope="repository:tsubaie/enan:pull"`)
			w.WriteHeader(http.StatusUnauthorized)
		case r.Method == http.MethodHead && r.URL.Path == "/v2/tsubaie/enan/manifests/edge" && strings.Contains(r.Header.Get("Accept"), "oci.image.index"):
			w.Header().Set("Docker-Content-Digest", "sha256:feed")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	host := strings.TrimPrefix(server.URL, "http://")
	client := New([]string{host})
	digest, err := client.Digest(context.Background(), Reference{Host: host, Path: "tsubaie/enan", Tag: "edge", Repository: host + "/tsubaie/enan"})
	if err != nil || digest != "sha256:feed" {
		t.Fatalf("digest %q, %v", digest, err)
	}
	if _, err := client.Digest(context.Background(), Reference{Host: host, Path: "tsubaie/enan", Tag: "gone", Repository: host + "/tsubaie/enan"}); err == nil {
		t.Fatal("an unknown tag resolved")
	}
}

// ADMIN-B67: an announced image's labels come from its index, manifest and config; no layer.
func TestLabelsReadsTheConfigOnly(t *testing.T) {
	platform := `{"os":"` + runtime.GOOS + `","architecture":"` + runtime.GOARCH + `"}`
	documents := map[string]string{
		"/v2/enan/manifests/sha256:index":    `{"manifests":[{"digest":"sha256:other","platform":{"os":"linux","architecture":"s390x"}},{"digest":"sha256:image","platform":` + platform + `}]}`,
		"/v2/enan/manifests/sha256:image":    `{"config":{"digest":"sha256:config"},"layers":[{"digest":"sha256:layer"}]}`,
		"/v2/enan/blobs/sha256:config":       `{"config":{"Labels":{"org.opencontainers.image.version":"2026.11.0","org.enan.contract":"8"}}}`,
		"/v2/enan/manifests/sha256:noconfig": `{}`,
	}
	var requested []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested = append(requested, r.URL.Path)
		if body, ok := documents[r.URL.Path]; ok && r.Method == http.MethodGet {
			w.Write([]byte(body))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	host := strings.TrimPrefix(server.URL, "http://")
	client := New([]string{host})
	ref := Reference{Host: host, Path: "enan", Tag: "latest", Repository: host + "/enan"}
	labels, err := client.Labels(context.Background(), ref, "sha256:index", "")
	if err != nil || labels["org.opencontainers.image.version"] != "2026.11.0" || labels["org.enan.contract"] != "8" {
		t.Fatalf("labels %v, %v", labels, err)
	}
	for _, path := range requested {
		if strings.Contains(path, "layer") || strings.Contains(path, "other") {
			t.Fatalf("requested %s", path)
		}
	}
	for _, digest := range []string{"sha256:noconfig", "sha256:gone"} {
		if _, err := client.Labels(context.Background(), ref, digest, ""); err == nil {
			t.Fatalf("%s read", digest)
		}
	}
}

// An install runs the platform of its app image, which may not be the updater's own.
func TestLabelsFollowsTheRunningPlatform(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/enan/manifests/sha256:index":
			w.Write([]byte(`{"manifests":[{"digest":"sha256:amd","platform":{"os":"linux","architecture":"amd64"}}]}`))
		case "/v2/enan/manifests/sha256:amd":
			w.Write([]byte(`{"config":{"digest":"sha256:config"}}`))
		case "/v2/enan/blobs/sha256:config":
			w.Write([]byte(`{"config":{"Labels":{"org.opencontainers.image.version":"2026.11.0"}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	host := strings.TrimPrefix(server.URL, "http://")
	ref := Reference{Host: host, Path: "enan", Tag: "latest", Repository: host + "/enan"}
	labels, err := New([]string{host}).Labels(context.Background(), ref, "sha256:index", "linux/amd64")
	if err != nil || labels["org.opencontainers.image.version"] != "2026.11.0" {
		t.Fatalf("labels %v, %v", labels, err)
	}
	if _, err := New([]string{host}).Labels(context.Background(), ref, "sha256:index", "linux/arm64"); err == nil {
		t.Fatal("an index without the platform resolved")
	}
}
