interface SelectorCandidate {
  selector: string;
  score: number;
}

const TEST_ATTRIBUTE_NAMES = [
  "data-testid",
  "data-test",
  "data-qa",
  "data-cy",
  "data-component",
];

const FRAGILE_CLASS_PATTERNS = [
  /^css-[a-z0-9]+$/i,
  /^jsx-\d+$/i,
  /^sc-[a-z0-9]+$/i,
  /^ember-view$/i,
  /^x\d+$/i,
];

function isLikelyStableValue(value: string): boolean {
  if (!value) {
    return false;
  }

  if (value.length > 80) {
    return false;
  }

  if (/\d{4,}/.test(value)) {
    return false;
  }

  return /^[a-zA-Z][a-zA-Z0-9:_-]*$/.test(value);
}

function isStableClassName(className: string): boolean {
  if (!className || className.length > 40) {
    return false;
  }

  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(className)) {
    return false;
  }

  return !FRAGILE_CLASS_PATTERNS.some((pattern) => pattern.test(className));
}

function countMatches(selector: string): number {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

function pushCandidate(
  candidates: SelectorCandidate[],
  selector: string,
  score: number,
): void {
  if (!selector || selector.includes("[data-zap-extension-root")) {
    return;
  }

  if (countMatches(selector) === 1) {
    candidates.push({ selector, score });
  }
}

function cssEscape(value: string): string {
  return CSS.escape(value);
}

function candidateFromAttributes(element: Element): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];
  const tagName = element.tagName.toLowerCase();

  for (const attributeName of TEST_ATTRIBUTE_NAMES) {
    const value = element.getAttribute(attributeName);
    if (!value || !isLikelyStableValue(value)) {
      continue;
    }

    pushCandidate(
      candidates,
      `[${attributeName}="${cssEscape(value)}"]`,
      100,
    );
    pushCandidate(
      candidates,
      `${tagName}[${attributeName}="${cssEscape(value)}"]`,
      95,
    );
  }

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.length < 80) {
    pushCandidate(
      candidates,
      `${tagName}[aria-label="${cssEscape(ariaLabel)}"]`,
      90,
    );
  }

  const role = element.getAttribute("role");
  if (role && ariaLabel && ariaLabel.length < 80) {
    pushCandidate(
      candidates,
      `[role="${cssEscape(role)}"][aria-label="${cssEscape(ariaLabel)}"]`,
      88,
    );
  }

  return candidates;
}

function candidateFromId(element: Element): SelectorCandidate[] {
  const id = element.id;
  if (!isLikelyStableValue(id)) {
    return [];
  }

  const selector = `#${cssEscape(id)}`;
  return countMatches(selector) === 1 ? [{ selector, score: 85 }] : [];
}

function candidateFromClasses(element: Element): SelectorCandidate[] {
  const tagName = element.tagName.toLowerCase();
  const classes = Array.from(element.classList).filter(isStableClassName).slice(0, 3);

  if (classes.length === 0) {
    return [];
  }

  const selector = `${tagName}${classes.map((className) => `.${cssEscape(className)}`).join("")}`;
  return countMatches(selector) === 1 ? [{ selector, score: 70 }] : [];
}

function buildStructuralSegment(element: Element): string {
  const tagName = element.tagName.toLowerCase();

  if (element.id && isLikelyStableValue(element.id)) {
    return `${tagName}#${cssEscape(element.id)}`;
  }

  const stableClasses = Array.from(element.classList).filter(isStableClassName).slice(0, 2);
  if (stableClasses.length > 0) {
    return `${tagName}${stableClasses.map((className) => `.${cssEscape(className)}`).join("")}`;
  }

  let index = 1;
  let sibling = element.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === element.tagName) {
      index += 1;
    }
    sibling = sibling.previousElementSibling;
  }

  return `${tagName}:nth-of-type(${index})`;
}

function buildStructuralFallback(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current && segments.length < 5) {
    segments.unshift(buildStructuralSegment(current));
    const selector = segments.join(" > ");
    if (countMatches(selector) === 1) {
      return selector;
    }
    current = current.parentElement;
  }

  return segments.join(" > ");
}

export function buildElementSelector(element: Element): string {
  const candidates = [
    ...candidateFromAttributes(element),
    ...candidateFromId(element),
    ...candidateFromClasses(element),
  ];

  candidates.sort((left, right) => right.score - left.score);
  if (candidates[0]) {
    return candidates[0].selector;
  }

  return buildStructuralFallback(element);
}

export function buildElementLabel(element: Element): string {
  const text = element.textContent?.replace(/\s+/g, " ").trim();
  if (text) {
    return text.slice(0, 72);
  }

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) {
    return ariaLabel.slice(0, 72);
  }

  const className = Array.from(element.classList)
    .filter(isStableClassName)
    .slice(0, 2)
    .join(".");

  const tagName = element.tagName.toLowerCase();
  return className ? `${tagName}.${className}` : tagName;
}
