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

// { "array": X } is the canonical way to write an array of X (spec: Generics,
// Application). It must behave exactly like the legacy [[X]] form.
test("an array application parses like the legacy nested-array form", () => {
  const pairs = [
    [{ array: "string" }, [["string"]]],
    [{ array: "object.user" }, [["object.user"]]],
    [{ array: ["string", "null"] }, [["string", "null"]]],
    [{ array: "T" }, [["T"]]],
    [{ array: { array: "string" } }, [[["string"]]]],
    [{ array: { "object.page": "object.user" } }, [[{ "object.page": "object.user" }]]],
    [{ "object.page": { array: "object.user" } }, { "object.page": [["object.user"]] }],
    [
      [{ array: "string" }, "null"],
      [["string"], "null"],
    ],
  ]
  for (const [application, legacy] of pairs) {
    const a = Type.parse(application)
    const l = Type.parse(legacy)
    assert.equal(a.toString(), l.toString(), JSON.stringify(application))
    assert.equal(a.format("base"), l.format("base"), JSON.stringify(application))
    assert.equal(a.format("compact"), l.format("compact"), JSON.stringify(application))
    assert.deepEqual(a.objects, l.objects, JSON.stringify(application))
  }
})

test("formats array applications", () => {
  assert.equal(Type.parse({ array: "string" }).toString(), "array<string>")
  assert.equal(Type.parse({ array: "object.user" }).toString(), "array<object.user>")
  assert.equal(Type.parse({ array: ["string", "number"] }).toString(), "array<string | number>")
  assert.equal(Type.parse({ array: { array: "string" } }).toString(), "array<array<string>>")
  assert.equal(Type.parse({ array: { "object.page": "object.user" } }).toString(), "array<object.page<object.user>>")
  assert.equal(Type.parse({ "object.page": { array: "object.user" } }).toString(), "object.page<array<object.user>>")
  assert.equal(Type.parse({ array: "T" }).toString(), "array<any>")
  assert.equal(Type.parse([{ array: "string" }, "null"]).toString(), "array<string> | null")
  assert.equal(Type.parse(["array", { array: "string" }]).toString(), "array<any> | array<string>")
  assert.equal(Type.parse({ array: "string" }).format("base"), "array")
})

test("collects object refs from inside array applications", () => {
  assert.deepEqual(Type.parse({ array: "object.user" }).objects, ["user"])
  assert.deepEqual(new Set(Type.parse({ array: { "object.page": "object.user" } }).objects), new Set(["page", "user"]))
  assert.deepEqual(new Set(Type.parse({ "object.page": { array: "object.user" } }).objects), new Set(["page", "user"]))
  assert.deepEqual(Type.parse({ array: { array: "object.user" } }).objects, ["user"])
})

test("validates values against array applications", () => {
  const strings = Type.parse({ array: "string" })
  assert.equal(strings.valid(["a", "b"]), true)
  assert.equal(strings.valid([]), true)
  assert.equal(strings.valid([1]), false)
  assert.equal(strings.valid("a"), false)
  assert.equal(strings.valid(null), false)

  const mixed = Type.parse({ array: ["string", "number"] })
  assert.equal(mixed.valid(["a", 1]), true)
  assert.equal(mixed.valid([true]), false)

  const nested = Type.parse({ array: { array: "number" } })
  assert.equal(nested.valid([[1], []]), true)
  assert.equal(nested.valid([["a"]]), false)
})

test("a malformed array application resolves to any instead of throwing", () => {
  for (const bad of [{ array: 5 }, { array: "string", "object.a": "string" }, { arrays: "string" }, { "array.x": "string" }, { Array: "string" }]) {
    const t = Type.parse(bad)
    assert.equal(t.toString(), "any", JSON.stringify(bad))
    assert.equal(t.valid("anything"), true)
  }
})

// Spec (Generics, Substitution): a union of one entry is that entry.
test("a union of one entry is that entry", () => {
  assert.equal(Type.parse(["string"]).format("base"), "string")
  assert.equal(Type.parse(["string.email"]).format("compact"), "email")
  assert.equal(Type.parse(["string.email"]).toString(), "string.email")
  assert.equal(Type.parse(["T"]).format("base"), "any")
  assert.equal(Type.parse([{ array: "string" }]).format("base"), "array")
  assert.equal(Type.parse([{ "object.list": "object.user" }]).format("base"), "object")
  // The legacy array shorthand is not a one-entry union: [["x"]] is still array<x>.
  assert.equal(Type.parse([["string"]]).format("base"), "array")
  assert.equal(Type.parse([["string"]]).toString(), "array<string>")
  // Unions of more than one entry are unchanged.
  assert.equal(Type.parse(["string", "null"]).format("base"), "union")
  // An empty array has no entry to collapse to, and still doesn't throw.
  assert.doesNotThrow(() => Type.parse([]).toString())
})