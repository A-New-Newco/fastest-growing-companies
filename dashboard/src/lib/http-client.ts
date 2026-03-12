import type { Campaign } from "@/types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;

  const error = payload.error;
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  const message = payload.message;
  if (typeof message === "string" && message.trim().length > 0) {
    return message;
  }

  return fallback;
}

export function isCampaign(value: unknown): value is Campaign {
  if (!isRecord(value)) return false;

  const description = value.description;
  return (
    typeof value.id === "string" &&
    typeof value.teamId === "string" &&
    typeof value.name === "string" &&
    (description === null || typeof description === "string") &&
    typeof value.status === "string" &&
    typeof value.createdBy === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}
