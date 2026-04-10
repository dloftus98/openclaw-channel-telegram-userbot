import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	addMessage,
	buildContext,
	clearHistory,
	getHistory,
	getStats,
	getSystemPrompt,
	initConversations,
} from "../conversation.js"

let testDir: string

beforeEach(() => {
	testDir = join(tmpdir(), `openclaw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
	try {
		rmSync(testDir, { recursive: true })
	} catch {}
})

describe("conversation", () => {
	test("init and add messages", () => {
		initConversations({ maxMessages: 5, dataDir: testDir })

		addMessage("chat1", {
			role: "user",
			sender: "Alice",
			text: "Hello",
			timestamp: 1000,
		})

		addMessage("chat1", {
			role: "assistant",
			sender: "Assistant",
			text: "Hi Alice!",
			timestamp: 2000,
		})

		const history = getHistory("chat1")
		expect(history).toHaveLength(2)
		expect(history[0].sender).toBe("Alice")
		expect(history[1].role).toBe("assistant")
	})

	test("trims to maxMessages", () => {
		initConversations({ maxMessages: 3, dataDir: testDir })

		for (let i = 0; i < 5; i++) {
			addMessage("chat1", {
				role: "user",
				sender: "Bob",
				text: `msg ${i}`,
				timestamp: i * 1000,
			})
		}

		const history = getHistory("chat1")
		expect(history).toHaveLength(3)
		expect(history[0].text).toBe("msg 2")
		expect(history[2].text).toBe("msg 4")
	})

	test("separate histories per chat", () => {
		initConversations({ maxMessages: 10, dataDir: testDir })

		addMessage("chat1", { role: "user", sender: "A", text: "chat1", timestamp: 1 })
		addMessage("chat2", { role: "user", sender: "B", text: "chat2", timestamp: 2 })

		expect(getHistory("chat1")).toHaveLength(1)
		expect(getHistory("chat2")).toHaveLength(1)
		expect(getHistory("chat1")[0].text).toBe("chat1")
		expect(getHistory("chat2")[0].text).toBe("chat2")
	})

	test("clearHistory removes messages", () => {
		initConversations({ maxMessages: 10, dataDir: testDir })
		addMessage("chat1", { role: "user", sender: "A", text: "hi", timestamp: 1 })
		expect(getHistory("chat1")).toHaveLength(1)
		clearHistory("chat1")
		expect(getHistory("chat1")).toHaveLength(0)
	})

	test("getStats counts correctly", () => {
		initConversations({ maxMessages: 10, dataDir: testDir })
		addMessage("chat1", { role: "user", sender: "A", text: "a", timestamp: 1 })
		addMessage("chat1", { role: "assistant", sender: "B", text: "b", timestamp: 2 })
		addMessage("chat2", { role: "user", sender: "C", text: "c", timestamp: 3 })

		const stats = getStats()
		expect(stats.chats).toBe(2)
		expect(stats.totalMessages).toBe(3)
	})

	test("system prompt per chat", () => {
		initConversations({
			maxMessages: 10,
			dataDir: testDir,
			defaultSystemPrompt: "You are helpful",
			systemPrompts: { chat1: "You are a coding assistant" },
		})

		expect(getSystemPrompt("chat1")).toBe("You are a coding assistant")
		expect(getSystemPrompt("chat2")).toBe("You are helpful")
		expect(getSystemPrompt("unknown")).toBe("You are helpful")
	})

	test("buildContext with system prompt and history", () => {
		initConversations({
			maxMessages: 10,
			dataDir: testDir,
			defaultSystemPrompt: "Be concise",
		})

		addMessage("chat1", { role: "user", sender: "Alice", text: "What is 2+2?", timestamp: 1 })
		addMessage("chat1", { role: "assistant", sender: "Assistant", text: "4", timestamp: 2 })
		addMessage("chat1", { role: "user", sender: "Alice", text: "And 3+3?", timestamp: 3 })

		const context = buildContext("chat1")
		expect(context).toContain("[System: Be concise]")
		expect(context).toContain("Alice: What is 2+2?")
		expect(context).toContain("Assistant: 4")
		expect(context).toContain("Alice: And 3+3?")
	})

	test("buildContext without system prompt", () => {
		initConversations({ maxMessages: 10, dataDir: testDir })

		addMessage("chat1", { role: "user", sender: "Bob", text: "hi", timestamp: 1 })

		const context = buildContext("chat1")
		expect(context).not.toContain("[System:")
		expect(context).toContain("Bob: hi")
	})

	test("empty history returns empty string", () => {
		initConversations({ maxMessages: 10, dataDir: testDir })
		expect(buildContext("nonexistent")).toBe("")
	})

	test("clamps invalid maxMessages", () => {
		initConversations({ maxMessages: -5, dataDir: testDir })
		// Should clamp to 1 minimum
		for (let i = 0; i < 3; i++) {
			addMessage("chat1", { role: "user", sender: "A", text: `msg ${i}`, timestamp: i })
		}
		expect(getHistory("chat1")).toHaveLength(1)
		expect(getHistory("chat1")[0].text).toBe("msg 2")
	})

	test("handles NaN maxMessages gracefully", () => {
		initConversations({ maxMessages: "notanumber", dataDir: testDir })
		// Should fallback to default (20)
		addMessage("chat1", { role: "user", sender: "A", text: "test", timestamp: 1 })
		expect(getHistory("chat1")).toHaveLength(1)
	})

	test("persistence — reload from disk", async () => {
		initConversations({ maxMessages: 10, dataDir: testDir })
		addMessage("chat1", { role: "user", sender: "A", text: "persisted", timestamp: 1 })

		// Wait for debounced save
		await new Promise((resolve) => setTimeout(resolve, 1500))

		// Re-init should load from disk
		initConversations({ maxMessages: 10, dataDir: testDir })
		const history = getHistory("chat1")
		expect(history).toHaveLength(1)
		expect(history[0].text).toBe("persisted")
	})

	test("skips invalid messages on load", async () => {
		const { writeFileSync } = await import("node:fs")
		initConversations({ maxMessages: 10, dataDir: testDir })

		// Write a file with mixed valid/invalid messages
		const data = {
			chatId: "chat1",
			messages: [
				{ role: "user", sender: "A", text: "valid", timestamp: 1 },
				{ role: "bad_role", sender: "B", text: "invalid role", timestamp: 2 },
				{ text: "missing fields" },
				{ role: "assistant", sender: "Bot", text: "also valid", timestamp: 3 },
			],
		}
		writeFileSync(join(testDir, "chat1.json"), JSON.stringify(data))

		// Re-init should filter out invalid messages
		initConversations({ maxMessages: 10, dataDir: testDir })
		const history = getHistory("chat1")
		expect(history).toHaveLength(2)
		expect(history[0].text).toBe("valid")
		expect(history[1].text).toBe("also valid")
	})

	test("gracefully handles unwritable dataDir", () => {
		// Passing a path inside a nonexistent root that can't be created
		// On most systems /proc is read-only
		initConversations({ maxMessages: 10, dataDir: "/proc/fake-openclaw-test" })

		// Should still work in memory-only mode
		addMessage("chat1", { role: "user", sender: "A", text: "hello", timestamp: 1 })
		expect(getHistory("chat1")).toHaveLength(1)
	})
})
