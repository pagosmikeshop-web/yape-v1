import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as postTelegramWebhook } from "../app/api/telegram/webhook/route";
import { POST as postTelegramVpsCommand } from "../app/api/internal/telegram/command/route";
import {
  inspectTelegramWebhookUpdate,
  telegramCommandBotToken,
  telegramCommandWebhookSecret,
  telegramMembershipBotToken,
  telegramWebhookDiagnosticsEnabled,
  type TelegramUpdate,
} from "../app/lib/telegram-manager";
import {
  signTelegramVpsForwardBody,
  TELEGRAM_VPS_SIGNATURE_HEADER,
  TELEGRAM_VPS_TIMESTAMP_HEADER,
} from "../app/lib/telegram-vps-forward";

type TestGlobals = typeof globalThis & {
  __YAPE_ENV?: Record<string, string | undefined>;
};

function setEnv(values: Record<string, string | undefined>) {
  (globalThis as TestGlobals).__YAPE_ENV = values;
}

function telegramEnv(...parts: string[]) {
  return parts.join("_");
}

afterEach(() => {
  delete (globalThis as TestGlobals).__YAPE_ENV;
  vi.restoreAllMocks();
});

describe("Telegram bot roles", () => {
  it("keeps the legacy variables working during migration", () => {
    setEnv({
      [telegramEnv("TELEGRAM", "BOT", "TOKEN")]: "legacy-token",
      [telegramEnv("TELEGRAM", "WEBHOOK", "SECRET")]: "legacy-webhook-secret",
    });

    expect(telegramMembershipBotToken()).toBe("legacy-token");
    expect(telegramCommandBotToken()).toBe("legacy-token");
    expect(telegramCommandWebhookSecret()).toBe("legacy-webhook-secret");
  });

  it("uses dedicated tokens when both bots are configured", () => {
    setEnv({
      [telegramEnv("TELEGRAM", "BOT", "TOKEN")]: "legacy-token",
      [telegramEnv("TELEGRAM", "MEMBERSHIP", "BOT", "TOKEN")]: "membership-token",
      [telegramEnv("TELEGRAM", "COMMAND", "BOT", "TOKEN")]: "command-token",
      [telegramEnv("TELEGRAM", "WEBHOOK", "SECRET")]: "legacy-webhook-secret",
      [telegramEnv("TELEGRAM", "COMMAND", "WEBHOOK", "SECRET")]: "command-webhook-secret",
    });

    expect(telegramMembershipBotToken()).toBe("membership-token");
    expect(telegramCommandBotToken()).toBe("command-token");
    expect(telegramCommandWebhookSecret()).toBe("command-webhook-secret");
  });
});

describe("Telegram webhook diagnostics", () => {
  it("classifies a message without exposing its text or identities", () => {
    const update: TelegramUpdate = {
      update_id: 123,
      message: {
        message_id: 7,
        text: "/redeem SECRET-CODE",
        chat: { id: -100123, type: "supergroup" },
        from: { id: 456 },
      },
    };

    expect(inspectTelegramWebhookUpdate(update)).toEqual({
      updateId: "123",
      updateType: "message",
      chatType: "supergroup",
    });
  });

  it("classifies other supported update envelopes safely", () => {
    const update: TelegramUpdate = {
      update_id: 124,
      callback_query: { message: { chat: { type: "private" } } },
    };

    expect(inspectTelegramWebhookUpdate(update)).toEqual({
      updateId: "124",
      updateType: "callback_query",
      chatType: "private",
    });
  });

  it("keeps per-update diagnostics disabled unless explicitly enabled", () => {
    setEnv({});
    expect(telegramWebhookDiagnosticsEnabled()).toBe(false);

    setEnv({ [telegramEnv("TELEGRAM", "WEBHOOK", "DIAGNOSTICS")]: "true" });
    expect(telegramWebhookDiagnosticsEnabled()).toBe(true);
  });

  it("rejects an invalid webhook secret before parsing or processing the update", async () => {
    setEnv({ [telegramEnv("TELEGRAM", "COMMAND", "WEBHOOK", "SECRET")]: "a".repeat(32) });
    const securityLog = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await postTelegramWebhook(new Request("https://example.test/api/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "wrong-secret" },
      body: "not-json",
    }));

    expect(response.status).toBe(401);
    expect(securityLog).toHaveBeenCalledWith(
      "[security-event]",
      expect.objectContaining({ outcome: "denied", reason: "authentication" }),
    );
  });

  it("accepts a valid but irrelevant update without emitting a success log by default", async () => {
    const secret = "b".repeat(32);
    setEnv({ [telegramEnv("TELEGRAM", "COMMAND", "WEBHOOK", "SECRET")]: secret });
    const securityLog = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await postTelegramWebhook(new Request("https://example.test/api/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": secret,
      },
      body: JSON.stringify({
        update_id: 125,
        message: {
          message_id: 8,
          text: "hola",
          chat: { id: 3, type: "private" },
          from: { id: 4 },
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(securityLog).not.toHaveBeenCalled();
  });
});

describe("Telegram VPS command forward", () => {
  it("rejects an unsigned request before command processing", async () => {
    setEnv({ [telegramEnv("TELEGRAM", "VPS", "FORWARD", "SECRET")]: "c".repeat(32) });

    const response = await postTelegramVpsCommand(new Request("https://example.test/api/internal/telegram/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ update_id: 126 }),
    }));

    expect(response.status).toBe(401);
  });

  it("accepts a valid irrelevant update without reaching the database", async () => {
    const secret = "d".repeat(32);
    const rawBody = JSON.stringify({
      update_id: 127,
      message: {
        message_id: 9,
        text: "hola",
        chat: { id: 3, type: "private" },
        from: { id: 4 },
      },
    });
    const timestamp = String(Date.now());
    setEnv({ [telegramEnv("TELEGRAM", "VPS", "FORWARD", "SECRET")]: secret });

    const response = await postTelegramVpsCommand(new Request("https://example.test/api/internal/telegram/command", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [TELEGRAM_VPS_TIMESTAMP_HEADER]: timestamp,
        [TELEGRAM_VPS_SIGNATURE_HEADER]: await signTelegramVpsForwardBody(rawBody, timestamp, secret),
      },
      body: rawBody,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, result: "ignored-private" });
  });

  it("rejects a correctly signed request outside the replay window", async () => {
    const secret = "e".repeat(32);
    const rawBody = JSON.stringify({ update_id: 128 });
    const timestamp = String(Date.now() - 91_000);
    setEnv({ [telegramEnv("TELEGRAM", "VPS", "FORWARD", "SECRET")]: secret });

    const response = await postTelegramVpsCommand(new Request("https://example.test/api/internal/telegram/command", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [TELEGRAM_VPS_TIMESTAMP_HEADER]: timestamp,
        [TELEGRAM_VPS_SIGNATURE_HEADER]: await signTelegramVpsForwardBody(rawBody, timestamp, secret),
      },
      body: rawBody,
    }));

    expect(response.status).toBe(401);
  });
});
