package typesafe

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/errs"
	"github.com/mayswind/ezbookkeeping/pkg/settings"
)

func newTestConfig(baseUrl string) *settings.Config {
	return &settings.Config{
		TypeSafeAPIKey:         "test-key",
		TypeSafeModelID:        "jev-latest",
		TypeSafeBaseURL:        baseUrl,
		TypeSafeRequestTimeout: 5000,
		TypeSafeProxy:          "none",
	}
}

func TestIsSystemOneEnabled(t *testing.T) {
	assert.True(t, IsSystemOneEnabled(newTestConfig("https://api.typesafe.ai/")))

	config := newTestConfig("https://api.typesafe.ai/")
	config.TypeSafeAPIKey = ""
	assert.False(t, IsSystemOneEnabled(config))
}

func TestSystemOneClientAsk_SendsRequestAndParsesAnswers(t *testing.T) {
	var receivedPath, receivedAuth string
	var receivedRequest map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		receivedAuth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &receivedRequest)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"jev-1.13.0","answers":{"item_0":{"type":"choice","choice":"A > Food","confidence":0.9,"probabilities":{"A > Food":0.95,"A > Drink":0.05}}},"usage":{"input_tokens":120,"output_tokens":3}}`))
	}))
	defer server.Close()

	client := NewSystemOneClient(newTestConfig(server.URL))
	response, err := client.Ask(core.NewNullContext(), 1, map[string]any{"receipt": "x"}, map[string]*SystemOneQuestion{
		"item_0": {Type: SystemOneQuestionTypeChoice, Instructions: "Which?", Criteria: map[string]*string{"A > Food": nil, "A > Drink": nil}},
	})

	assert.Nil(t, err)
	assert.Equal(t, "/v1/systemone", receivedPath)
	assert.Equal(t, "Bearer test-key", receivedAuth)
	assert.Equal(t, "jev-latest", receivedRequest["model"])
	assert.Equal(t, map[string]any{"receipt": "x"}, receivedRequest["state"])
	assert.Equal(t, "A > Food", response.Answers["item_0"].Choice)
	assert.Equal(t, 0.95, response.Answers["item_0"].Probabilities["A > Food"])
	assert.Equal(t, int64(120), response.Usage.InputTokens)
}

func TestSystemOneClientAsk_NonOkStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"detail":[{"loc":["body","questions"],"msg":"invalid","type":"value_error"}]}`))
	}))
	defer server.Close()

	_, err := NewSystemOneClient(newTestConfig(server.URL+"/")).Ask(core.NewNullContext(), 1, "state", map[string]*SystemOneQuestion{
		"q": {Type: SystemOneQuestionTypeChoice, Instructions: "Which?", Criteria: map[string]*string{"a": nil}},
	})

	assert.Equal(t, errs.ErrFailedToRequestRemoteApi, err)
}

func TestSystemOneClientAsk_InvalidJson(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`not json`))
	}))
	defer server.Close()

	_, err := NewSystemOneClient(newTestConfig(server.URL)).Ask(core.NewNullContext(), 1, "state", map[string]*SystemOneQuestion{
		"q": {Type: SystemOneQuestionTypeChoice, Instructions: "Which?", Criteria: map[string]*string{"a": nil}},
	})

	assert.Equal(t, errs.ErrFailedToRequestRemoteApi, err)
}
