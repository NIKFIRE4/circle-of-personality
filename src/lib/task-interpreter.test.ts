import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  inferLocalCategoryId,
  interpretTaskCommand,
  taskAiConfigFromEnvironment,
  type TaskAiConfig,
} from "./task-interpreter";

const AI_CONFIG: TaskAiConfig = {
  apiKey: "test-api-key",
  baseUrl: "https://provider.example/v1/",
  model: "qwen-test",
  timeoutMs: 1_000,
};

const ENV_KEYS = [
  "TASK_AI_API_KEY",
  "GIGACHAT_CREDENTIALS",
  "GIGACHAT_SCOPE",
  "GIGACHAT_BASE_URL",
  "GIGACHAT_MODEL",
  "GIGACHAT_OAUTH_URL",
  "CLOUDFLARE_AI_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "API_KEY",
  "TASK_AI_BASE_URL",
  "TASK_AI_MODEL",
  "TASK_AI_TIMEOUT_MS",
] as const;

type AiTaskPayload = {
  version: 1;
  intent: "create_event" | "unsupported" | "unknown";
  title: string | null;
  categoryState: "matched" | "ambiguous" | "none";
  categoryId: string | null;
  temporalState: "resolved" | "ambiguous" | "missing" | "invalid";
  startLocal: string | null;
  endLocal: string | null;
  ambiguityCodes: string[];
};

function aiTask(overrides: Partial<AiTaskPayload> = {}): AiTaskPayload {
  return {
    version: 1,
    intent: "create_event",
    title: "Тренировка",
    categoryState: "matched",
    categoryId: "health-id",
    temporalState: "resolved",
    startLocal: "2026-08-09T13:00:00",
    endLocal: "2026-08-09T15:00:00",
    ambiguityCodes: [],
    ...overrides,
  };
}

function completionResponse(
  payload: AiTaskPayload,
  model = "qwen/mock-model",
): Response {
  return Response.json({
    model,
    choices: [{ message: { content: JSON.stringify(payload) } }],
  });
}

describe("interpretTaskCommand", () => {
  it("uses an AI result for a typo, preserves the category, and applies Europe/Moscow", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      completionResponse(aiTask()),
    );
    const text = "Тренировка с тренадцати до пятнадцати послезавтра";

    const result = await interpretTaskCommand({
      text,
      categories: [{ id: "health-id", name: "Здоровье", slug: "health" }],
      timeZone: "Europe/Moscow",
      now: new Date("2026-08-07T08:30:00.000Z"),
      aiConfig: AI_CONFIG,
      fetchImpl: fetchMock,
    });

    expect(result).toEqual({
      event: {
        title: "Тренировка",
        startAt: "2026-08-09T10:00:00.000Z",
        endAt: "2026-08-09T12:00:00.000Z",
        confidence: 0.98,
        needsConfirmation: true,
        categoryId: "health-id",
      },
      interpreter: {
        mode: "ai",
        model: "qwen/mock-model",
      },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, request] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("https://provider.example/v1/chat/completions");
    expect(request?.headers).toEqual({
      accept: "application/json",
      authorization: "Bearer test-api-key",
      "content-type": "application/json",
      "user-agent": "circle-of-personality/1.0",
    });

    const body = JSON.parse(String(request?.body));
    const userInput = JSON.parse(body.messages[1].content);
    expect(userInput).toMatchObject({
      command: text,
      referenceNow: "2026-08-07T11:30:00+03:00",
      timeZone: "Europe/Moscow",
      categories: [{ id: "health-id", name: "Здоровье" }],
    });
  });

  it("uses a dedicated OpenRouter fallback when the selected free model is rate-limited", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(
        { error: { code: 429, message: "Provider returned error" } },
        { status: 429 },
      ))
      .mockResolvedValueOnce(
        completionResponse(aiTask(), "google/gemma-4-26b-a4b-it:free"),
      );

    const result = await interpretTaskCommand({
      text: "Тренировка с тренадцати до пятнадцати послезавтра",
      categories: [{ id: "health-id", name: "Здоровье", slug: "health" }],
      timeZone: "Europe/Moscow",
      now: new Date("2026-08-07T08:30:00.000Z"),
      aiConfig: {
        apiKey: "openrouter-key",
        provider: "openai-compatible",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "google/gemma-4-31b-it:free",
        timeoutMs: 1_000,
      },
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const fallbackBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstBody).toMatchObject({
      model: "google/gemma-4-31b-it:free",
      reasoning: { effort: "none" },
    });
    expect(fallbackBody).toMatchObject({
      model: "google/gemma-4-26b-a4b-it:free",
      reasoning: { effort: "none" },
    });
    expect(result.interpreter).toEqual({
      mode: "ai",
      model: "google/gemma-4-26b-a4b-it:free",
    });
  });

  it("uses the OpenRouter free router when both Gemma variants are unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(completionResponse(aiTask(), "nvidia/free-model"));

    const result = await interpretTaskCommand({
      text: "Тренировка с 13 до 15 послезавтра",
      categories: [{ id: "health-id", name: "Здоровье", slug: "health" }],
      timeZone: "Europe/Moscow",
      now: new Date("2026-08-07T08:30:00.000Z"),
      aiConfig: {
        apiKey: "openrouter-key",
        provider: "openai-compatible",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "google/gemma-4-31b-it:free",
        timeoutMs: 1_000,
      },
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
      model: "openrouter/free",
      reasoning: { effort: "none" },
    });
    expect(result.interpreter).toEqual({ mode: "ai", model: "nvidia/free-model" });
  });

  it("exchanges GigaChat credentials for an access token and requests strict JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "giga-access-token" }))
      .mockResolvedValueOnce(completionResponse(aiTask(), "GigaChat-2"));

    const result = await interpretTaskCommand({
      text: "Тренировка с тренадцати до пятнадцати послезавтра",
      categories: [{ id: "health-id", name: "Здоровье", slug: "health" }],
      timeZone: "Europe/Moscow",
      now: new Date("2026-08-07T08:30:00.000Z"),
      aiConfig: {
        provider: "gigachat",
        apiKey: "unique-gigachat-credentials-for-test",
        baseUrl: "https://api.giga.chat/v1",
        model: "GigaChat-2",
        oauthUrl: "https://oauth.giga.test/token",
        scope: "GIGACHAT_API_PERS",
        timeoutMs: 1_000,
      },
      fetchImpl: fetchMock,
    });

    expect(result.interpreter).toEqual({ mode: "ai", model: "GigaChat-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [oauthUrl, oauthRequest] = fetchMock.mock.calls[0];
    expect(oauthUrl).toBe("https://oauth.giga.test/token");
    expect((oauthRequest?.headers as Record<string, string>).authorization)
      .toBe("Basic unique-gigachat-credentials-for-test");
    expect(String(oauthRequest?.body)).toBe("scope=GIGACHAT_API_PERS");

    const [, chatRequest] = fetchMock.mock.calls[1];
    expect((chatRequest?.headers as Record<string, string>).authorization)
      .toBe("Bearer giga-access-token");
    const body = JSON.parse(String(chatRequest?.body));
    expect(body.response_format).toMatchObject({ type: "json_schema", strict: true });
    expect(body.response_format.schema.required).toContain("startLocal");
  });

  it("rejects a category ID hallucinated by the model", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      completionResponse(aiTask({ categoryId: "invented-category" })),
    );

    const result = await interpretTaskCommand({
      text: "Встреча с 13 до 15 послезавтра",
      categories: [{ id: "health-id", name: "Здоровье", slug: "health" }],
      timeZone: "Europe/Moscow",
      now: new Date("2026-08-07T08:30:00.000Z"),
      aiConfig: AI_CONFIG,
      fetchImpl: fetchMock,
    });

    expect(result.interpreter.mode).toBe("ai");
    expect(result.event).not.toHaveProperty("categoryId");
  });

  it("uses a conservative local category when AI leaves it unmatched", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      completionResponse(aiTask({ categoryState: "none", categoryId: null })),
    );

    const result = await interpretTaskCommand({
      text: "Тренировка с 13 до 15 послезавтра",
      categories: [{ id: "health-id", name: "Здоровье", slug: "health" }],
      timeZone: "Europe/Moscow",
      now: new Date("2026-08-07T08:30:00.000Z"),
      aiConfig: AI_CONFIG,
      fetchImpl: fetchMock,
    });

    expect(result.event.categoryId).toBe("health-id");
  });

  it.each([null, "Новое событие"])(
    "derives an activity title from the command when AI returns %s",
    async (title) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        completionResponse(aiTask({ title, categoryId: "rest-id" })),
      );

      const result = await interpretTaskCommand({
        text: "Сегодня с 15 до 17:00 иду гулять.",
        categories: [{ id: "rest-id", name: "Отдых", slug: "rest" }],
        timeZone: "Europe/Moscow",
        now: new Date("2026-08-07T08:30:00.000Z"),
        aiConfig: AI_CONFIG,
        fetchImpl: fetchMock,
      });

      expect(result.event.title).toBe("Иду гулять");
    },
  );

  it.each([
    [
      "a 429 response",
      () => new Response("rate limited", { status: 429 }),
    ],
    [
      "malformed model JSON",
      () => Response.json({
        choices: [{ message: { content: "{ definitely not valid JSON" } }],
      }),
    ],
  ])("falls back to the local parser after %s", async (_case, response) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response());

    const result = await interpretTaskCommand({
      text: "С 13 до 15 послезавтра здоровье",
      categories: [{ id: "health-id", name: "Здоровье", slug: "health" }],
      timeZone: "Europe/Moscow",
      now: new Date("2026-08-07T08:30:00.000Z"),
      aiConfig: AI_CONFIG,
      fetchImpl: fetchMock,
    });

    expect(result.interpreter).toEqual({
      mode: "local",
      fallbackReason: "provider_unavailable",
    });
    expect(result.event).toMatchObject({
      startAt: "2026-08-09T10:00:00.000Z",
      endAt: "2026-08-09T12:00:00.000Z",
      categoryId: "health-id",
    });
  });
});

describe("taskAiConfigFromEnvironment", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) vi.stubEnv(key, "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when no provider API key is configured", () => {
    expect(taskAiConfigFromEnvironment()).toBeNull();
  });

  it("uses Groq defaults for GROQ_API_KEY", () => {
    vi.stubEnv("GROQ_API_KEY", "groq-key");

    expect(taskAiConfigFromEnvironment()).toEqual({
      apiKey: "groq-key",
      provider: "openai-compatible",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "qwen/qwen3.6-27b",
      timeoutMs: 20_000,
    });
  });

  it("uses OpenRouter defaults when it is the only configured provider", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");

    expect(taskAiConfigFromEnvironment()).toEqual({
      apiKey: "openrouter-key",
      provider: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "google/gemma-4-31b-it:free",
      timeoutMs: 20_000,
    });
  });

  it("accepts API_KEY as a backwards-compatible OpenRouter alias", () => {
    vi.stubEnv("API_KEY", "legacy-openrouter-key");

    expect(taskAiConfigFromEnvironment()).toEqual({
      apiKey: "legacy-openrouter-key",
      provider: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "google/gemma-4-31b-it:free",
      timeoutMs: 20_000,
    });
  });

  it("prefers explicit values and accepts a bounded timeout", () => {
    vi.stubEnv("TASK_AI_API_KEY", " explicit-key ");
    vi.stubEnv("GROQ_API_KEY", "groq-key");
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
    vi.stubEnv("TASK_AI_BASE_URL", " https://custom.example/api ");
    vi.stubEnv("TASK_AI_MODEL", " deepseek-custom ");
    vi.stubEnv("TASK_AI_TIMEOUT_MS", "30000");

    expect(taskAiConfigFromEnvironment()).toEqual({
      apiKey: "explicit-key",
      provider: "openai-compatible",
      baseUrl: "https://custom.example/api",
      model: "deepseek-custom",
      timeoutMs: 30_000,
    });
  });

  it.each(["999", "30001", "not-a-number"])(
    "uses the default timeout for invalid TASK_AI_TIMEOUT_MS=%s",
    (timeout) => {
      vi.stubEnv("TASK_AI_API_KEY", "explicit-key");
      vi.stubEnv("TASK_AI_TIMEOUT_MS", timeout);

      expect(taskAiConfigFromEnvironment()?.timeoutMs).toBe(20_000);
    },
  );

  it("uses GigaChat defaults for personal Russian-language projects", () => {
    vi.stubEnv("GIGACHAT_CREDENTIALS", "giga-credentials");

    expect(taskAiConfigFromEnvironment()).toEqual({
      apiKey: "giga-credentials",
      provider: "gigachat",
      baseUrl: "https://api.giga.chat/v1",
      model: "GigaChat-2",
      timeoutMs: 20_000,
      oauthUrl: "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
      scope: "GIGACHAT_API_PERS",
    });
  });

  it("builds Cloudflare Workers AI Qwen defaults", () => {
    vi.stubEnv("CLOUDFLARE_AI_API_TOKEN", "cloudflare-token");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account-id");

    expect(taskAiConfigFromEnvironment()).toEqual({
      apiKey: "cloudflare-token",
      provider: "openai-compatible",
      baseUrl: "https://api.cloudflare.com/client/v4/accounts/account-id/ai/v1",
      model: "@cf/qwen/qwen3-30b-a3b-fp8",
      timeoutMs: 20_000,
    });
  });

  it("allows an unauthenticated local OpenAI-compatible model", () => {
    vi.stubEnv("TASK_AI_BASE_URL", "http://127.0.0.1:11434/v1");
    vi.stubEnv("TASK_AI_MODEL", "qwen3.5:4b");

    expect(taskAiConfigFromEnvironment()).toEqual({
      provider: "openai-compatible",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen3.5:4b",
      timeoutMs: 20_000,
    });
  });
});

describe("inferLocalCategoryId", () => {
  const spheres = [
    { id: "health-id", name: "Здоровье", slug: "health" },
    { id: "career-id", name: "Карьера", slug: "career" },
    { id: "relationships-id", name: "Отношения", slug: "relationships" },
    { id: "growth-id", name: "Развитие", slug: "growth" },
    { id: "rest-id", name: "Отдых", slug: "rest" },
    { id: "environment-id", name: "Окружение", slug: "environment" },
  ];

  it("matches everyday calendar titles without an AI provider", () => {
    expect(inferLocalCategoryId("Стоматолог", spheres)).toBe("health-id");
    expect(inferLocalCategoryId("Созвон с заказчиком", spheres)).toBe("career-id");
    expect(inferLocalCategoryId("День рождения Маши", spheres)).toBe("relationships-id");
    expect(inferLocalCategoryId("Урок английского", spheres)).toBe("growth-id");
    expect(inferLocalCategoryId("Продукты в магазине", spheres)).toBe("environment-id");
  });

  it("picks the strongest sphere instead of giving up on a tie", () => {
    // "работа" and "дома" pull in different directions; the title carries two
    // career stems, so the event lands somewhere instead of nowhere.
    expect(inferLocalCategoryId("Работа над проектом дома", spheres)).toBe("career-id");
  });

  it("prefers a literal sphere name over keywords", () => {
    expect(inferLocalCategoryId("Планирую отдых", spheres)).toBe("rest-id");
  });

  it("still returns nothing when no sphere is implied", () => {
    expect(inferLocalCategoryId("Ыфваы", spheres)).toBeUndefined();
  });

  it("leaves user-created spheres to the literal name match", () => {
    const custom = [{ id: "pets-id", name: "Питомцы", slug: "pitomcy" }];

    expect(inferLocalCategoryId("Питомцы: ветеринар", custom)).toBe("pets-id");
    expect(inferLocalCategoryId("Ветеринар", custom)).toBeUndefined();
  });
});
