import { describe, it, expect, vi } from "vitest";
import { createOgImageFetcher } from "../src/services/ogImage";

const html = (body: string) =>
  new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });

const OG =
  '<html><head><meta property="og:image" content="https://images.craigslist.org/00p0p_abc_600x450.jpg"></head></html>';

describe("createOgImageFetcher", () => {
  it("reads the og:image meta tag", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => html(OG));
    const out = await createOgImageFetcher(
      fetchImpl as unknown as typeof fetch
    )("https://sfbay.craigslist.org/x/1.html");

    expect(out).toBe("https://images.craigslist.org/00p0p_abc_600x450.jpg");
  });

  it("handles the attribute order being reversed", async () => {
    const reversed =
      '<meta content="https://images.craigslist.org/00z_xyz_600x450.jpg" property="og:image">';
    const fetchImpl = vi.fn().mockImplementation(() => html(reversed));
    const out = await createOgImageFetcher(
      fetchImpl as unknown as typeof fetch
    )("https://a.b/c");

    expect(out).toBe("https://images.craigslist.org/00z_xyz_600x450.jpg");
  });

  it("falls back to the first craigslist image in the body", async () => {
    const body =
      '<img src="https://images.craigslist.org/00k0k_fallback_600x450.jpg">';
    const fetchImpl = vi.fn().mockImplementation(() => html(body));
    const out = await createOgImageFetcher(
      fetchImpl as unknown as typeof fetch
    )("https://a.b/c");

    expect(out).toBe("https://images.craigslist.org/00k0k_fallback_600x450.jpg");
  });

  it("returns null when the page has no image", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => html("<html></html>"));
    expect(
      await createOgImageFetcher(fetchImpl as unknown as typeof fetch)(
        "https://a.b/c"
      )
    ).toBeNull();
  });

  it("returns null on a non-2xx rather than throwing", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => new Response("gone", { status: 404 }));
    expect(
      await createOgImageFetcher(fetchImpl as unknown as typeof fetch)(
        "https://a.b/c"
      )
    ).toBeNull();
  });

  it("returns null when the fetch throws, never failing the ingest", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    expect(
      await createOgImageFetcher(fetchImpl as unknown as typeof fetch)(
        "https://a.b/c"
      )
    ).toBeNull();
  });
});
