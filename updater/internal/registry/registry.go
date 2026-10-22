// Package registry resolves an image tag to the digest a registry serves for it, anonymously, with
// the OCI distribution API. Only public images are supported.
package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
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
	scheme := "https"
	if c.Insecure[ref.Host] {
		scheme = "http"
	}
	target := fmt.Sprintf("%s://%s/v2/%s/manifests/%s", scheme, ref.Host, ref.Path, url.PathEscape(ref.Tag))
	token := ""
	for attempt := 0; attempt < 2; attempt++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodHead, target, nil)
		if err != nil {
			return "", err
		}
		request.Header.Set("Accept", accept)
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		response, err := c.HTTP.Do(request)
		if err != nil {
			return "", err
		}
		response.Body.Close()
		switch {
		case response.StatusCode == http.StatusUnauthorized && token == "":
			token, err = c.token(ctx, response.Header.Get("WWW-Authenticate"))
			if err != nil {
				return "", err
			}
			continue
		case response.StatusCode != http.StatusOK:
			return "", fmt.Errorf("%s:%s: registry answered %s", ref.Repository, ref.Tag, response.Status)
		}
		digest := response.Header.Get("Docker-Content-Digest")
		if !strings.HasPrefix(digest, "sha256:") {
			return "", fmt.Errorf("%s:%s: registry sent no digest", ref.Repository, ref.Tag)
		}
		return digest, nil
	}
	return "", fmt.Errorf("%s:%s: registry refused an anonymous token", ref.Repository, ref.Tag)
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
