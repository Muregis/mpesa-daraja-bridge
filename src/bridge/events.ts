export interface SseClient {
  id: string
  write: (data: string) => void
  close: () => void
}

/**
 * In-memory real-time event bus for connected cashier terminals.
 * Dispatches Server-Sent Events (SSE) with sub-millisecond local latency.
 */
export class BridgeEventBus {
  private clients = new Map<string, SseClient>()
  private heartbeatTimer?: NodeJS.Timeout | undefined

  constructor() {
    // Keep connections alive across proxies with a periodic heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.broadcast('ping', { timestamp: new Date().toISOString() })
    }, 15000)
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref()
    }
  }

  addClient(client: SseClient): void {
    this.clients.set(client.id, client)
    // Send immediate initial handshake
    client.write(this.formatMessage('connected', {
      clientId: client.id,
      timestamp: new Date().toISOString(),
      activeTerminals: this.clients.size,
    }))
  }

  removeClient(id: string): void {
    const client = this.clients.get(id)
    if (client) {
      this.clients.delete(id)
    }
  }

  broadcast(event: string, payload: unknown): void {
    const message = this.formatMessage(event, payload)
    for (const [id, client] of this.clients.entries()) {
      try {
        client.write(message)
      } catch {
        this.clients.delete(id)
      }
    }
  }

  private formatMessage(event: string, payload: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
  }

  get clientCount(): number {
    return this.clients.size
  }

  destroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
    for (const client of this.clients.values()) {
      try {
        client.close()
      } catch {
        // ignore
      }
    }
    this.clients.clear()
  }
}
