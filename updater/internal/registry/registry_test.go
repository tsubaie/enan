package registry

import (
	"context"
	"net/http"
	"net/http/httptest"
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
