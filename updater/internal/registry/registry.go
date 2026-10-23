// Package registry resolves an image tag to the digest a registry serves for it, and reads an
// image's labels, anonymously, with the OCI distribution API. Only public images are supported.
package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"time"
)

// Reference is repository:tag split into the parts the API needs.
type Reference struct {
	Host       string // ghcr.io
	Path       string // tsubaie/enan
	Tag        string // edge
	Repository string // ghcr.io/tsubaie/enan
}

// Parse splits a reference such as ghcr.io/tsubaie/enan:edge. A reference without a registry host
// is on Docker Hub.
func Parse(ref string) (Reference, error) {
	if strings.Contains(ref, "@") {
		return Reference{}, fmt.Errorf("%s is pinned to a digest; give the updater a tag to follow", ref)
	}
	repository, tag := ref, "latest"
	if slash, colon := strings.LastIndex(ref, "/"), strings.LastIndex(ref, ":"); colon > slash {
		repository, tag = ref[:colon], ref[colon+1:]
	}
	host, path, found := strings.Cut(repository, "/")
	if !found || !strings.ContainsAny(host, ".:") && host != "localhost" {
		host, path = "registry-1.docker.io", repository
		if !strings.Contains(path, "/") {
			path = "library/" + path
		}
	}
	return Reference{Host: host, Path: path, Tag: tag, Repository: repository}, nil
}

type Client struct {
	HTTP *http.Client
	// Insecure hosts are reached over plain HTTP: a local test registry, never a real one.
	Insecure map[string]bool
}

func New(insecure []string) *Client {
	hosts := map[string]bool{}
	for _, host := range insecure {
		if host = strings.TrimSpace(host); host != "" {
			hosts[host] = true
		}
	}
	return &Client{HTTP: &http.Client{Timeout: 30 * time.Second}, Insecure: hosts}
}

var accept = strings.Join([]string{
	"application/vnd.oci.image.index.v1+json",
	"application/vnd.oci.image.manifest.v1+json",
	"application/vnd.docker.distribution.manifest.list.v2+json",
	"application/vnd.docker.distribution.manifest.v2+json",
}, ", ")

// Digest returns the digest the registry serves for ref's tag.
func (c *Client) Digest(ctx context.Context, ref Reference) (string, error) {
	response, err := c.fetch(ctx, http.MethodHead, ref, "manifests/"+url.PathEscape(ref.Tag), accept)
	if err != nil {
		return "", err
	}
	response.Body.Close()
	digest := response.Header.Get("Docker-Content-Digest")
	if !strings.HasPrefix(digest, "sha256:") {
		return "", fmt.Errorf("%s:%s: registry sent no digest", ref.Repository, ref.Tag)
	}
	return digest, nil
}

// Labels reads the labels of the image digest names, from its manifest and config only: the
// layers are not downloaded (ADMIN-B67: nothing is pulled before Install now). An index is
// resolved to the entry for platform (os/arch), or for the updater's own when it is "".
func (c *Client) Labels(ctx context.Context, ref Reference, digest, platform string) (map[string]string, error) {
	if platform == "" {
		platform = runtime.GOOS + "/" + runtime.GOARCH
	}
	var manifest struct {
		Manifests []struct {
			Digest   string `json:"digest"`
			Platform struct {
				OS           string `json:"os"`
				Architecture string `json:"architecture"`
			} `json:"platform"`
		} `json:"manifests"`
		Config struct {
			Digest string `json:"digest"`
		} `json:"config"`
	}
	if err := c.json(ctx, ref, "manifests/"+digest, accept, &manifest); err != nil {
		return nil, err
	}
	if len(manifest.Manifests) > 0 {
		for _, entry := range manifest.Manifests {
			if entry.Platform.OS+"/"+entry.Platform.Architecture == platform {
				return c.Labels(ctx, ref, entry.Digest, platform)
			}
		}
		return nil, fmt.Errorf("%s@%s has no image for %s", ref.Repository, digest, platform)
	}
	if !strings.HasPrefix(manifest.Config.Digest, "sha256:") {
		return nil, fmt.Errorf("%s@%s: the manifest names no config", ref.Repository, digest)
	}
	var config struct {
		Config struct {
			Labels map[string]string `json:"Labels"`
		} `json:"config"`
	}
	if err := c.json(ctx, ref, "blobs/"+manifest.Config.Digest, "*/*", &config); err != nil {
		return nil, err
	}
	return config.Config.Labels, nil
}

// shortcut: a manifest or config larger than this is refused; both are a few KB in practice.
const maxDocument = 4 << 20

func (c *Client) json(ctx context.Context, ref Reference, path, accept string, into any) error {
	response, err := c.fetch(ctx, http.MethodGet, ref, path, accept)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if err := json.NewDecoder(io.LimitReader(response.Body, maxDocument)).Decode(into); err != nil {
		return fmt.Errorf("%s %s: %w", ref.Repository, path, err)
	}
	return nil
}

// fetch requests /v2/<path>/<rest>, answering one anonymous token challenge, and returns a 200.
func (c *Client) fetch(ctx context.Context, method string, ref Reference, rest, accept string) (*http.Response, error) {
	scheme := "https"
	if c.Insecure[ref.Host] {
		scheme = "http"
	}
	target := fmt.Sprintf("%s://%s/v2/%s/%s", scheme, ref.Host, ref.Path, rest)
	token := ""
	for attempt := 0; attempt < 2; attempt++ {
		request, err := http.NewRequestWithContext(ctx, method, target, nil)
		if err != nil {
			return nil, err
		}
		request.Header.Set("Accept", accept)
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		response, err := c.HTTP.Do(request)
		if err != nil {
			return nil, err
		}
		switch {
		case response.StatusCode == http.StatusUnauthorized && token == "":
			response.Body.Close()
			if token, err = c.token(ctx, response.Header.Get("WWW-Authenticate")); err != nil {
				return nil, err
			}
			continue
		case response.StatusCode != http.StatusOK:
			response.Body.Close()
			return nil, fmt.Errorf("%s %s: registry answered %s", ref.Repository, rest, response.Status)
		}
		return response, nil
	}
	return nil, fmt.Errorf("%s %s: registry refused an anonymous token", ref.Repository, rest)
}

// token answers a Bearer challenge anonymously, which a public repository accepts.
func (c *Client) token(ctx context.Context, challenge string) (string, error) {
	params := map[string]string{}
	rest, ok := strings.CutPrefix(challenge, "Bearer ")
	if !ok {
		return "", fmt.Errorf("unsupported registry challenge %q", challenge)
	}
	for _, part := range splitParams(rest) {
		key, value, _ := strings.Cut(part, "=")
		params[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), `"`)
	}
	realm, err := url.Parse(params["realm"])
	if err != nil || params["realm"] == "" {
		return "", fmt.Errorf("registry challenge without a realm: %q", challenge)
	}
	query := realm.Query()
	for _, key := range []string{"service", "scope"} {
		if params[key] != "" {
			query.Set(key, params[key])
		}
	}
	realm.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, realm.String(), nil)
	if err != nil {
		return "", err
	}
	response, err := c.HTTP.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("registry token: %s", response.Status)
	}
	var body struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		return "", err
	}
	if body.Token != "" {
		return body.Token, nil
	}
	return body.AccessToken, nil
}

// splitParams splits a challenge's comma-separated parameters, keeping commas inside quotes
// (a scope can list several actions: "repository:x:pull,push").
func splitParams(text string) []string {
	var parts []string
	quoted, start := false, 0
	for i, r := range text {
		switch {
		case r == '"':
			quoted = !quoted
		case r == ',' && !quoted:
			parts = append(parts, text[start:i])
			start = i + 1
		}
	}
	return append(parts, text[start:])
}
