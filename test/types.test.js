import { test } from "node:test"
import assert from "node:assert/strict"
import { Type } from "../src/types.js"

test("parses base types", () => {
  assert.equal(Type.parse("string").toString(), "string")
  assert.equal(Type.parse(null).toString(), "any")
  assert.equal(Type.parse("array").toString(), "array<any>")
})

test("parses refined types and formats them", () => {
  const t = Type.parse("string.email")
  assert.equal(t.toString(), "string.email")
  assert.equal(t.format("base"), "string")
  assert.equal(t.format("compact"), "email")
})

test("parses unions from a top-level array", () => {
  assert.equal(Type.parse(["object", "null"]).toString(), "object | null")
})

test("parses arrays from a nested array", () => {
  assert.equal(Type.parse([["string"]]).toString(), "array<string>")
})

test("parses object references and reports them via .objects", () => {
  const t = Type.parse("object.user")
  assert.equal(t.toString(), "object.user")
  assert.deepEqual(t.objects, ["user"])
})

test("collects object refs from inside unions and arrays", () => {
  const t = Type.parse([["object.user"], "null"])
  assert.deepEqual(new Set(t.objects), new Set(["user"]))
})

test("validates values against refinements", () => {
  const email = Type.parse("string.email")
  assert.equal(email.valid("ada@example.com"), true)
  assert.equal(email.valid("not-an-email"), false)

  const uuid = Type.parse("string.uuid")
  assert.equal(uuid.valid("550e8400-e29b-41d4-a716-446655440000"), true)
  assert.equal(uuid.valid("nope"), false)
})

test("validates unions and arrays recursively", () => {
  const t = Type.parse(["object", "null"])
  assert.equal(t.valid(null), true)
  assert.equal(t.valid({}), true)
  assert.equal(t.valid("nope"), false)

  const arr = Type.parse([["number"]])
  assert.equal(arr.valid([1, 2, 3]), true)
  assert.equal(arr.valid([1, "two"]), false)
})

test("parses a generic application", () => {
  const t = Type.parse({ "object.list": "object.user" })
  assert.equal(t.toString(), "object.list<object.user>")
  assert.equal(t.format("base"), "object")
  assert.deepEqual(new Set(t.objects), new Set(["list", "user"]))
  assert.equal(t.valid({}), true)
  assert.equal(t.valid("nope"), false)
})

test("parses union, nested and array arguments in a generic application", () => {
  assert.equal(Type.parse({ "object.list": ["object.user", "null"] }).toString(), "object.list<object.user | null>")
  assert.equal(Type.parse({ "object.page": { "object.page": "object.user" } }).toString(), "object.page<object.page<object.user>>")
  assert.equal(Type.parse({ "object.list": [["string"]] }).toString(), "object.list<array<string>>")
  assert.deepEqual(new Set(Type.parse({ "object.page": { "object.page": "object.user" } }).objects), new Set(["page", "user"]))
})

test("parses generic applications inside unions and arrays", () => {
  assert.equal(Type.parse([{ "object.list": "object.user" }, "null"]).toString(), "object.list<object.user> | null")
  assert.equal(Type.parse([[{ "object.list": "object.user" }]]).toString(), "array<object.list<object.user>>")
  assert.equal(Type.parse([[{ "object.list": "object.user" }, "null"]]).toString(), "array<object.list<object.user> | null>")
})

test("a malformed generic application resolves to any instead of throwing", () => {
  for (const bad of [
    {},
    { "object.a": "string", "object.b": "string" },
    { string: "object.user" },
    { list: "object.user" },
    { "object.": "string" },
    { "object.list": 5 },
  ]) {
    const t = Type.parse(bad)
    assert.equal(t.toString(), "any", JSON.stringify(bad))
    assert.equal(t.valid("anything"), true)
  }
  // ...and is kept (as any) inside a union rather than dropped.
  assert.equal(Type.parse([{ string: "x" }, "null"]).toString(), "any | null")
})

test("an array type inside a union stays an array type", () => {
  assert.equal(Type.parse([["string"], "null"]).toString(), "array<string> | null")
  assert.equal(Type.parse([["string"], ["number"]]).toString(), "array<string> | array<number>")
  assert.equal(Type.parse(["array", ["object.person"]]).toString(), "array<any> | array<object.person>")
  assert.equal(Type.parse([["string"], "null"]).valid(["a"]), true)
  assert.equal(Type.parse([["string"], "null"]).valid("a"), false)
})

test("the unresolved type parameter T resolves to any", () => {
  assert.equal(Type.parse("T").toString(), "any")
  assert.equal(Type.parse([["T"]]).toString(), "array<any>")
  assert.equal(Type.parse(["T", "null"]).toString(), "any | null")
  assert.equal(Type.parse("T").valid("anything"), true)
  // Only the bare token: an object named T is an ordinary reference.
  assert.equal(Type.parse("object.T").toString(), "object.T")
})