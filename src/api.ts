// SPDX-License-Identifier: Apache-2.0

/** What the daemon answers: one JSON object with a `type`. */
export interface Reply {
  type: string;
  [field: string]: unknown;
}

/** The daemon refused or could not answer. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * One connection to a daemon: `POST /api` with a bearer token and one request of the protocol as
 * JSON. The token is kept in memory only; there are no cookies.
 */
export class Client {
  constructor(
    readonly base: string,
    private readonly token: string,
    private readonly doFetch: Fetch = (i, init) => fetch(i, init),
  ) {}

  /** Sends a request; an `error` reply or a refusal by the listener is thrown as `ApiError`. */
  async call(request: { op: string; [field: string]: unknown }, signal?: AbortSignal): Promise<Reply> {
    let response: Response;
    try {
      response = await this.doFetch(`${this.base}/api`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        cache: "no-store",
        credentials: "omit",
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw e;
      }
      throw new ApiError(`cannot reach the daemon at ${this.base}`, 0);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(`the daemon answered ${response.status} without a reply`, response.status);
    }
    if (typeof body !== "object" || body === null || typeof (body as Reply).type !== "string") {
      throw new ApiError("the answer is not a reply of the protocol", response.status);
    }
    const reply = body as Reply;
    if (reply.type === "error" || !response.ok) {
      const message = typeof reply["message"] === "string" ? reply["message"] : `status ${response.status}`;
      throw new ApiError(message, response.status);
    }
    return reply;
  }
}

/** The address of a daemon as the person typed it: http(s) and a host, nothing else. */
export function normaliseBase(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("that is not an address like http://127.0.0.1:8484");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("the address must start with http:// or https://");
  }
  if (url.username || url.password) {
    throw new Error("the address must not contain a user name or password");
  }
  return url.origin;
}
