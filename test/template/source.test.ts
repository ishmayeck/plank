import { describe, it, expect, afterEach } from "vitest";
import {
  createTemplate,
  setTemplateLoader,
  getActiveTheme,
} from "../../src/template/source.js";
import { compile, serializeAst, clearTemplateCaches } from "../../src/template/engine.js";
import { PrecompiledTemplateLoader } from "../../src/template/loader.js";

describe("template source switch (Chunk 21 → Chunk 22 seam)", () => {
  afterEach(() => {
    setTemplateLoader(null); // always revert to filesystem default
    clearTemplateCaches();
  });

  it("defaults to the filesystem theme (renders a real Solaris template)", () => {
    expect(getActiveTheme()).toBe("Solaris");
    const tpl = createTemplate();
    tpl.loadFile("footer", "overall_footer.tpl");
    expect(tpl.render("footer")).toContain("</html>");
  });

  it("renders entirely from a precompiled loader once installed (no fs)", () => {
    // Simulate the deployment boot step: install a precompiled source.
    const loader = new PrecompiledTemplateLoader({
      "overall_footer.tpl": serializeAst(compile("<footer>{SITE}</footer>")),
    });
    setTemplateLoader(loader);

    const tpl = createTemplate();
    tpl.loadFile("footer", "overall_footer.tpl");
    tpl.assignVars({ SITE: "Plank" });
    expect(tpl.render("footer")).toBe("<footer>Plank</footer>");
  });

  it("reverts cleanly to the filesystem when the loader is removed", () => {
    setTemplateLoader(new PrecompiledTemplateLoader());
    setTemplateLoader(null);
    const tpl = createTemplate();
    tpl.loadFile("footer", "overall_footer.tpl");
    expect(tpl.render("footer")).toContain("</html>");
  });
});
