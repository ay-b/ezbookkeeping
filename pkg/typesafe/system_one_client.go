package typesafe

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/errs"
	"github.com/mayswind/ezbookkeeping/pkg/httpclient"
	"github.com/mayswind/ezbookkeeping/pkg/log"
	"github.com/mayswind/ezbookkeeping/pkg/settings"
)

const systemOneApiPath = "v1/systemone"

// SystemOneQuestionTypeChoice represents the choice question type which selects one option from a defined set
const SystemOneQuestionTypeChoice = "choice"

// SystemOneQuestion represents a question asked to the TypeSafe System One model
type SystemOneQuestion struct {
	Type         string             `json:"type"`
	Instructions any                `json:"instructions,omitempty"`
	Criteria     map[string]*string `json:"criteria,omitempty"`
}

// SystemOneRequest represents the request of TypeSafe System One api
type SystemOneRequest struct {
	Model     string                        `json:"model"`
	State     any                           `json:"state"`
	Questions map[string]*SystemOneQuestion `json:"questions"`
}

// SystemOneAnswer represents an answer of TypeSafe System One api
type SystemOneAnswer struct {
	Type          string             `json:"type"`
	Choice        string             `json:"choice"`
	Confidence    float64            `json:"confidence"`
	Probabilities map[string]float64 `json:"probabilities"`
}

// SystemOneUsage represents the token usage of TypeSafe System One api
type SystemOneUsage struct {
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
}

// SystemOneResponse represents the response of TypeSafe System One api
type SystemOneResponse struct {
	Model   string                      `json:"model"`
	Answers map[string]*SystemOneAnswer `json:"answers"`
	Usage   *SystemOneUsage             `json:"usage"`
}

// SystemOneClient represents the client of TypeSafe System One api
type SystemOneClient struct {
	httpClient *http.Client
	apiUrl     string
	apiKey     string
	modelId    string
}

// IsSystemOneEnabled returns whether the TypeSafe System One api is configured
func IsSystemOneEnabled(config *settings.Config) bool {
	return config.TypeSafeAPIKey != "" && config.TypeSafeModelID != "" && config.TypeSafeBaseURL != ""
}

// NewSystemOneClient returns a new TypeSafe System One api client according to the current config
func NewSystemOneClient(config *settings.Config) *SystemOneClient {
	baseUrl := config.TypeSafeBaseURL

	if !strings.HasSuffix(baseUrl, "/") {
		baseUrl += "/"
	}

	return &SystemOneClient{
		httpClient: httpclient.NewHttpClient(config.TypeSafeRequestTimeout, config.TypeSafeProxy, config.TypeSafeSkipTLSVerify, core.GetOutgoingUserAgent(), config.EnableDebugLog, []uint16{}),
		apiUrl:     baseUrl + systemOneApiPath,
		apiKey:     config.TypeSafeAPIKey,
		modelId:    config.TypeSafeModelID,
	}
}

// Ask asks all the questions about the state in one request and returns the answers
func (s *SystemOneClient) Ask(c core.Context, uid int64, state any, questions map[string]*SystemOneQuestion) (*SystemOneResponse, error) {
	requestBody, err := json.Marshal(&SystemOneRequest{
		Model:     s.modelId,
		State:     state,
		Questions: questions,
	})

	if err != nil {
		log.Errorf(c, "[system_one_client.Ask] failed to marshal request for user \"uid:%d\", because %s", uid, err.Error())
		return nil, errs.ErrOperationFailed
	}

	httpRequest, err := http.NewRequest("POST", s.apiUrl, bytes.NewReader(requestBody))

	if err != nil {
		log.Errorf(c, "[system_one_client.Ask] failed to build request for user \"uid:%d\", because %s", uid, err.Error())
		return nil, errs.ErrFailedToRequestRemoteApi
	}

	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", "Bearer "+s.apiKey)
	httpRequest = httpRequest.WithContext(httpclient.CustomHttpResponseLog(c, func(data []byte) {
		log.Debugf(c, "[system_one_client.Ask] response is %s", data)
	}))

	resp, err := s.httpClient.Do(httpRequest)

	if err != nil {
		log.Errorf(c, "[system_one_client.Ask] failed to request typesafe api for user \"uid:%d\", because %s", uid, err.Error())
		return nil, errs.ErrFailedToRequestRemoteApi
	}

	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)

	if err != nil {
		log.Errorf(c, "[system_one_client.Ask] failed to read typesafe api response for user \"uid:%d\", because %s", uid, err.Error())
		return nil, errs.ErrFailedToRequestRemoteApi
	}

	if resp.StatusCode != http.StatusOK {
		log.Errorf(c, "[system_one_client.Ask] failed to get typesafe api response for user \"uid:%d\", because response code is %d, response is %s", uid, resp.StatusCode, body)
		return nil, errs.ErrFailedToRequestRemoteApi
	}

	response := &SystemOneResponse{}
	err = json.Unmarshal(body, response)

	if err != nil {
		log.Errorf(c, "[system_one_client.Ask] failed to parse typesafe api response for user \"uid:%d\", because %s", uid, err.Error())
		return nil, errs.ErrFailedToRequestRemoteApi
	}

	if response.Usage != nil {
		log.Infof(c, "[system_one_client.Ask] user \"uid:%d\" asked %d questions to model \"%s\", used %d input tokens and %d output tokens", uid, len(questions), response.Model, response.Usage.InputTokens, response.Usage.OutputTokens)
	}

	return response, nil
}
