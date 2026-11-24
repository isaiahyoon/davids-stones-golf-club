import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pageDefinitions = [
  {
    file: "index.html",
    route: "/",
    title: "데이빗 스톤 골프 클럽 | 기본기부터 단단하게",
    currentNavigation: null,
  },
  {
    file: "approach/index.html",
    route: "/approach/",
    title: "레슨 철학 | 데이빗 스톤 골프 클럽",
    currentNavigation: "/approach/",
  },
  {
    file: "lessons/index.html",
    route: "/lessons/",
    title: "레슨 · 피팅 | 데이빗 스톤 골프 클럽",
    currentNavigation: "/lessons/",
  },
  {
    file: "visit/index.html",
    route: "/visit/",
    title: "방문 안내 | 데이빗 스톤 골프 클럽",
    currentNavigation: "/visit/",
  },
];

function readFile(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function getTags(markup, name) {
  return [...markup.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(([tag]) => tag);
}

function getAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2];
}

function resolveLocalReference(reference, route) {
  const url = new URL(reference, `https://site.test${route}`);
  if (url.origin !== "https://site.test") return null;

  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname.endsWith("/")
    ? path.join(pathname, "index.html")
    : pathname;
  return path.join(root, relativePath);
}

function assertUniqueIds(markup, pageName) {
  const ids = getTags(markup, "[a-z][\\w-]*")
    .map((tag) => getAttribute(tag, "id"))
    .filter(Boolean);

  assert.equal(new Set(ids).size, ids.length, `${pageName} has duplicate IDs`);
  return new Set(ids);
}

for (const page of pageDefinitions) {
  test(`${page.route} has complete metadata and accessible navigation`, () => {
    const markup = readFile(page.file);

    assert.match(markup, /<!doctype html>/i);
    assert.match(markup, /<html\b[^>]*\blang="ko"/i);
    assert.equal(markup.match(/<title>(.*?)<\/title>/s)?.[1], page.title);
    assert.match(markup, /<meta\s+name="description"\s+content="[^"]+"/i);
    assert.match(markup, /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1"/i);
    assert.match(markup, /<a\b[^>]*class="skip-link"[^>]*href="#main"/);
    assert.match(markup, /<main\b[^>]*id="main"/);
    assert.match(markup, /<h1\b/);

    const menuButton = getTags(markup, "button").find((tag) =>
      /\bclass="menu-toggle"/.test(tag),
    );
    assert.ok(menuButton, `${page.file} has a mobile menu button`);
    assert.equal(getAttribute(menuButton, "aria-expanded"), "false");
    assert.equal(getAttribute(menuButton, "aria-controls"), "site-nav");
    assert.ok(getAttribute(menuButton, "aria-label"));

    const navigation = getTags(markup, "nav").find((tag) =>
      /\bid="site-nav"/.test(tag),
    );
    assert.ok(navigation, `${page.file} has the primary navigation`);

    const navLinks = getTags(markup, "a").filter((tag) =>
      /href="\/(?:approach|lessons|visit)\/"/.test(tag),
    );
    const currentLinks = navLinks.filter((tag) =>
      /aria-current="page"/.test(tag),
    );
    if (page.currentNavigation) {
      assert.equal(currentLinks.length, 1);
      assert.equal(getAttribute(currentLinks[0], "href"), page.currentNavigation);
    } else {
      assert.equal(currentLinks.length, 0);
    }

    const ids = assertUniqueIds(markup, page.file);
    for (const tag of getTags(markup, "a")) {
      const href = getAttribute(tag, "href");
      if (href?.startsWith("#")) {
        assert.ok(ids.has(href.slice(1)), `${page.file} has a target for ${href}`);
      }

      if (getAttribute(tag, "target") === "_blank") {
        assert.match(getAttribute(tag, "rel") ?? "", /\bnoreferrer\b/);
      }
    }

    const favicon = getTags(markup, "link").find((tag) =>
      /rel="icon"/.test(tag),
    );
    assert.ok(favicon, `${page.file} declares a favicon`);
    assert.equal(getAttribute(favicon, "href"), "/assets/favicon.svg");
  });
}

test("all local page references point to existing files", () => {
  for (const page of pageDefinitions) {
    const markup = readFile(page.file);
    const references = getTags(markup, "[a-z][\\w-]*")
      .flatMap((tag) => ["href", "src"].map((attribute) => getAttribute(tag, attribute)))
      .filter((reference) => reference && !reference.startsWith("#"));

    for (const reference of references) {
      const target = resolveLocalReference(reference, page.route);
      if (target) {
        assert.ok(statSync(target).isFile(), `${page.file} references missing file ${reference}`);
      }
    }
  }
});

test("all content images have alternative text", () => {
  for (const page of pageDefinitions) {
    for (const image of getTags(readFile(page.file), "img")) {
      assert.ok(getAttribute(image, "alt")?.trim(), `${page.file} has an image without alt text`);
    }
  }
});

test("link arrows are consistent decorative SVGs without changing link labels", () => {
  const expectedLabels = {
    "index.html": ["레슨 철학 알아보기", "클럽 방문 안내", "레슨 철학", "레슨 · 피팅", "찾아오시는 길"],
    "approach/index.html": ["Yelp에서 남긴 레슨 후기"],
    "visit/index.html": ["지도에서 위치 확인", "Yelp에서 더 알아보기"],
    "lessons/index.html": [],
  };
  let arrowMarkup;

  for (const page of pageDefinitions) {
    const markup = readFile(page.file);
    assert.doesNotMatch(markup, /↗/);
    const links = [...markup.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
      .map(([, content]) => content)
      .filter((content) => /class="link-arrow"/.test(content));
    assert.deepEqual(
      links.map((content) => content.replace(/<svg\b[\s\S]*?<\/svg>/, "").trim()),
      expectedLabels[page.file],
    );

    for (const link of links) {
      const svg = link.match(/<svg\b[\s\S]*?<\/svg>/)?.[0];
      assert.ok(svg);
      assert.match(svg, /aria-hidden="true"/);
      assert.match(svg, /focusable="false"/);
      assert.match(svg, /stroke="currentColor"/);
      arrowMarkup ??= svg;
      assert.equal(svg, arrowMarkup);
    }
  }
});

test("favicon is a scalable SVG using the site palette", () => {
  const favicon = readFile("assets/favicon.svg");
  assert.match(favicon, /<svg\b[^>]*viewBox="0 0 48 48"/);
  assert.match(favicon, /#172720/i);
  assert.match(favicon, /#c9ab72/i);
});

test("mobile navigation styles match the menu interaction", () => {
  const stylesheet = readFile("styles.css");
  assert.match(stylesheet, /@media \(max-width: 640px\)[\s\S]*?\.menu-toggle\s*\{[^}]*display:\s*flex/);
  assert.match(stylesheet, /\.site-nav\.is-open\s*\{\s*display:\s*flex/);
});

class FakeElement {
  constructor(attributes = {}, links = []) {
    this.attributes = new Map(Object.entries(attributes));
    this.listeners = new Map();
    this.links = links;
    this.focused = false;
    this.classList = {
      classes: new Set(),
      add: (name) => this.classList.classes.add(name),
      remove: (name) => this.classList.classes.delete(name),
      contains: (name) => this.classList.classes.has(name),
      toggle: (name, force) => {
        if (force) this.classList.classes.add(name);
        else this.classList.classes.delete(name);
        return force;
      },
    };
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type, event = {}) {
    this.listeners.get(type)?.(event);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  querySelectorAll() {
    return this.links;
  }

  focus() {
    this.focused = true;
  }
}

function createMenuHarness() {
  const links = [new FakeElement(), new FakeElement()];
  const menuToggle = new FakeElement({
    "aria-expanded": "false",
    "aria-label": "메뉴 열기",
  });
  const siteNav = new FakeElement({}, links);
  const documentListeners = new Map();
  const mediaListeners = new Map();
  const document = {
    querySelector: (selector) =>
      selector === ".menu-toggle" ? menuToggle : siteNav,
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    dispatch: (type, event) => documentListeners.get(type)?.(event),
  };
  const mediaQuery = {
    addEventListener: (type, listener) => mediaListeners.set(type, listener),
    dispatch: (type, event) => mediaListeners.get(type)?.(event),
  };
  const window = { matchMedia: () => mediaQuery };

  vm.runInNewContext(readFile("script.js"), { document, window });

  return { links, menuToggle, siteNav, document, mediaQuery };
}

test("mobile menu toggles visibility and its accessible label", () => {
  const { menuToggle, siteNav } = createMenuHarness();

  menuToggle.dispatch("click");
  assert.equal(menuToggle.getAttribute("aria-expanded"), "true");
  assert.equal(menuToggle.getAttribute("aria-label"), "메뉴 닫기");
  assert.equal(siteNav.classList.contains("is-open"), true);

  menuToggle.dispatch("click");
  assert.equal(menuToggle.getAttribute("aria-expanded"), "false");
  assert.equal(menuToggle.getAttribute("aria-label"), "메뉴 열기");
  assert.equal(siteNav.classList.contains("is-open"), false);
});

test("selecting a navigation link closes the mobile menu", () => {
  const { links, menuToggle, siteNav } = createMenuHarness();
  menuToggle.dispatch("click");

  links[0].dispatch("click");

  assert.equal(menuToggle.getAttribute("aria-expanded"), "false");
  assert.equal(menuToggle.getAttribute("aria-label"), "메뉴 열기");
  assert.equal(siteNav.classList.contains("is-open"), false);
});

test("Escape closes the open menu and restores focus to its button", () => {
  const { menuToggle, siteNav, document } = createMenuHarness();
  menuToggle.dispatch("click");

  document.dispatch("keydown", { key: "Escape" });

  assert.equal(menuToggle.getAttribute("aria-expanded"), "false");
  assert.equal(siteNav.classList.contains("is-open"), false);
  assert.equal(menuToggle.focused, true);
});

test("changing to desktop width closes the mobile menu", () => {
  const { menuToggle, siteNav, mediaQuery } = createMenuHarness();
  menuToggle.dispatch("click");

  mediaQuery.dispatch("change");

  assert.equal(menuToggle.getAttribute("aria-expanded"), "false");
  assert.equal(siteNav.classList.contains("is-open"), false);
});
