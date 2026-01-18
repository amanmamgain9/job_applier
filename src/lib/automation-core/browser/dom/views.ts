/**
 * DOM Node types for element representation
 */

import type { CoordinateSet, HashedDomElement, ViewportInfo } from './history';
import { capTextLength } from '../util';

export const DEFAULT_INCLUDE_ATTRIBUTES = [
  'title',
  'type',
  'checked',
  'name',
  'role',
  'value',
  'placeholder',
  'data-date-format',
  'data-state',
  'alt',
  'aria-checked',
  'aria-label',
  'aria-expanded',
  'href',
];

export abstract class DOMBaseNode {
  isVisible: boolean;
  parent: DOMElementNode | null;

  constructor(isVisible: boolean, parent?: DOMElementNode | null) {
    this.isVisible = isVisible;
    this.parent = parent ?? null;
  }
}

export class DOMTextNode extends DOMBaseNode {
  type = 'TEXT_NODE' as const;
  text: string;

  constructor(text: string, isVisible: boolean, parent?: DOMElementNode | null) {
    super(isVisible, parent);
    this.text = text;
  }

  hasParentWithHighlightIndex(): boolean {
    let current = this.parent;
    while (current != null) {
      if (current.highlightIndex !== null) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  isParentInViewport(): boolean {
    if (this.parent === null) {
      return false;
    }
    return this.parent.isInViewport;
  }

  isParentTopElement(): boolean {
    if (this.parent === null) {
      return false;
    }
    return this.parent.isTopElement;
  }
}

export class DOMElementNode extends DOMBaseNode {
  tagName: string | null;
  xpath: string | null;
  attributes: Record<string, string>;
  children: DOMBaseNode[];
  isInteractive: boolean;
  isTopElement: boolean;
  isInViewport: boolean;
  shadowRoot: boolean;
  highlightIndex: number | null;
  viewportCoordinates?: CoordinateSet;
  pageCoordinates?: CoordinateSet;
  viewportInfo?: ViewportInfo;
  isNew: boolean | null;

  // Reserved for future caching of hashed values
  // @ts-expect-error Reserved for future use
  private _hashedValue?: HashedDomElement;

  constructor(params: {
    tagName: string | null;
    xpath: string | null;
    attributes: Record<string, string>;
    children: DOMBaseNode[];
    isVisible: boolean;
    isInteractive?: boolean;
    isTopElement?: boolean;
    isInViewport?: boolean;
    shadowRoot?: boolean;
    highlightIndex?: number | null;
    viewportCoordinates?: CoordinateSet;
    pageCoordinates?: CoordinateSet;
    viewportInfo?: ViewportInfo;
    isNew?: boolean | null;
    parent?: DOMElementNode | null;
  }) {
    super(params.isVisible, params.parent);
    this.tagName = params.tagName;
    this.xpath = params.xpath;
    this.attributes = params.attributes;
    this.children = params.children;
    this.isInteractive = params.isInteractive ?? false;
    this.isTopElement = params.isTopElement ?? false;
    this.isInViewport = params.isInViewport ?? false;
    this.shadowRoot = params.shadowRoot ?? false;
    this.highlightIndex = params.highlightIndex ?? null;
    this.viewportCoordinates = params.viewportCoordinates;
    this.pageCoordinates = params.pageCoordinates;
    this.viewportInfo = params.viewportInfo;
    this.isNew = params.isNew ?? null;
  }

  getAllTextTillNextClickableElement(maxDepth = -1): string {
    const textParts: string[] = [];

    const collectText = (node: DOMBaseNode, currentDepth: number): void => {
      if (maxDepth !== -1 && currentDepth > maxDepth) {
        return;
      }

      if (node instanceof DOMElementNode && node !== this && node.highlightIndex !== null) {
        return;
      }

      if (node instanceof DOMTextNode) {
        textParts.push(node.text);
      } else if (node instanceof DOMElementNode) {
        for (const child of node.children) {
          collectText(child, currentDepth + 1);
        }
      }
    };

    collectText(this, 0);
    return textParts.join('\n').trim();
  }

  clickableElementsToString(includeAttributes: string[] | null = null): string {
    const formattedText: string[] = [];

    if (!includeAttributes) {
      includeAttributes = DEFAULT_INCLUDE_ATTRIBUTES;
    }

    const processNode = (node: DOMBaseNode, depth: number): void => {
      let nextDepth = depth;
      const depthStr = '\t'.repeat(depth);

      if (node instanceof DOMElementNode) {
        if (node.highlightIndex !== null) {
          nextDepth += 1;

          const text = node.getAllTextTillNextClickableElement();
          let attributesHtmlStr: string | null = null;

          if (includeAttributes) {
            const attributesToInclude: Record<string, string> = {};

            for (const [key, value] of Object.entries(node.attributes)) {
              if (includeAttributes.includes(key) && String(value).trim() !== '') {
                attributesToInclude[key] = String(value).trim();
              }
            }

            const orderedKeys = includeAttributes.filter(key => key in attributesToInclude);

            if (orderedKeys.length > 1) {
              const keysToRemove = new Set<string>();
              const seenValues: Record<string, string> = {};

              for (const key of orderedKeys) {
                const value = attributesToInclude[key];
                if (value.length > 5) {
                  if (value in seenValues) {
                    keysToRemove.add(key);
                  } else {
                    seenValues[value] = key;
                  }
                }
              }

              for (const key of keysToRemove) {
                delete attributesToInclude[key];
              }
            }

            if (node.tagName === attributesToInclude.role) {
              delete attributesToInclude.role;
            }

            const attrsToRemoveIfTextMatches = ['aria-label', 'placeholder', 'title'];
            for (const attr of attrsToRemoveIfTextMatches) {
              if (
                attributesToInclude[attr] &&
                attributesToInclude[attr].trim().toLowerCase() === text.trim().toLowerCase()
              ) {
                delete attributesToInclude[attr];
              }
            }

            if (Object.keys(attributesToInclude).length > 0) {
              attributesHtmlStr = Object.entries(attributesToInclude)
                .map(([key, value]) => `${key}=${capTextLength(value, 15)}`)
                .join(' ');
            }
          }

          const highlightIndicator = node.isNew ? `*[${node.highlightIndex}]` : `[${node.highlightIndex}]`;

          let line = `${depthStr}${highlightIndicator}<${node.tagName}`;

          if (attributesHtmlStr) {
            line += ` ${attributesHtmlStr}`;
          }

          if (text) {
            const trimmedText = text.trim();
            if (!attributesHtmlStr) {
              line += ' ';
            }
            line += `>${trimmedText}`;
          } else if (!attributesHtmlStr) {
            line += ' ';
          }

          line += ' />';
          formattedText.push(line);
        }

        for (const child of node.children) {
          processNode(child, nextDepth);
        }
      } else if (node instanceof DOMTextNode) {
        if (node.hasParentWithHighlightIndex()) {
          return;
        }

        if (node.parent && node.parent.isVisible && node.parent.isTopElement) {
          formattedText.push(`${depthStr}${node.text}`);
        }
      }
    };

    processNode(this, 0);
    return formattedText.join('\n');
  }

  getFileUploadElement(checkSiblings = true): DOMElementNode | null {
    if (this.tagName === 'input' && this.attributes?.type === 'file') {
      return this;
    }

    for (const child of this.children) {
      if (child instanceof DOMElementNode) {
        const result = child.getFileUploadElement(false);
        if (result) return result;
      }
    }

    if (checkSiblings && this.parent) {
      for (const sibling of this.parent.children) {
        if (sibling !== this && sibling instanceof DOMElementNode) {
          const result = sibling.getFileUploadElement(false);
          if (result) return result;
        }
      }
    }

    return null;
  }

  convertSimpleXPathToCssSelector(xpath: string): string {
    if (!xpath) {
      return '';
    }

    const cleanXpath = xpath.replace(/^\//, '');
    const parts = cleanXpath.split('/');
    const cssParts: string[] = [];

    for (const part of parts) {
      if (!part) {
        continue;
      }

      if (part.includes(':') && !part.includes('[')) {
        const basePart = part.replace(/:/g, '\\:');
        cssParts.push(basePart);
        continue;
      }

      if (part.includes('[')) {
        const bracketIndex = part.indexOf('[');
        let basePart = part.substring(0, bracketIndex);

        if (basePart.includes(':')) {
          basePart = basePart.replace(/:/g, '\\:');
        }

        const indexPart = part.substring(bracketIndex);
        const indices = indexPart
          .split(']')
          .slice(0, -1)
          .map(i => i.replace('[', ''));

        for (const idx of indices) {
          if (/^\d+$/.test(idx)) {
            try {
              const index = Number.parseInt(idx, 10) - 1;
              basePart += `:nth-of-type(${index + 1})`;
            } catch {
              // continue
            }
          } else if (idx === 'last()') {
            basePart += ':last-of-type';
          } else if (idx.includes('position()')) {
            if (idx.includes('>1')) {
              basePart += ':nth-of-type(n+2)';
            }
          }
        }

        cssParts.push(basePart);
      } else {
        cssParts.push(part);
      }
    }

    return cssParts.join(' > ');
  }

  enhancedCssSelectorForElement(includeDynamicAttributes = true): string {
    try {
      if (!this.xpath) {
        return '';
      }

      let cssSelector = this.convertSimpleXPathToCssSelector(this.xpath);

      const classValue = this.attributes.class;
      if (classValue && includeDynamicAttributes) {
        const validClassNamePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
        const classes = classValue.trim().split(/\s+/);
        for (const className of classes) {
          if (!className.trim()) {
            continue;
          }
          if (validClassNamePattern.test(className)) {
            cssSelector += `.${className}`;
          }
        }
      }

      const SAFE_ATTRIBUTES = new Set([
        'id',
        'name',
        'type',
        'placeholder',
        'aria-label',
        'aria-labelledby',
        'aria-describedby',
        'role',
        'for',
        'autocomplete',
        'required',
        'readonly',
        'alt',
        'title',
        'src',
        'href',
        'target',
      ]);

      if (includeDynamicAttributes) {
        SAFE_ATTRIBUTES.add('data-id');
        SAFE_ATTRIBUTES.add('data-qa');
        SAFE_ATTRIBUTES.add('data-cy');
        SAFE_ATTRIBUTES.add('data-testid');
      }

      for (const [attribute, value] of Object.entries(this.attributes)) {
        if (attribute === 'class') {
          continue;
        }

        if (!attribute.trim()) {
          continue;
        }

        if (!SAFE_ATTRIBUTES.has(attribute)) {
          continue;
        }

        const safeAttribute = attribute.replace(':', '\\:');

        if (value === '') {
          cssSelector += `[${safeAttribute}]`;
        } else if (/["'<>`\n\r\t]/.test(value)) {
          const collapsedValue = value.replace(/\s+/g, ' ').trim();
          const safeValue = collapsedValue.replace(/"/g, '\\"');
          cssSelector += `[${safeAttribute}*="${safeValue}"]`;
        } else {
          cssSelector += `[${safeAttribute}="${value}"]`;
        }
      }

      return cssSelector;
    } catch {
      const tagName = this.tagName || '*';
      return `${tagName}[highlightIndex='${this.highlightIndex}']`;
    }
  }

  getEnhancedCssSelector(): string {
    return this.enhancedCssSelectorForElement();
  }
}

export interface DOMState {
  elementTree: DOMElementNode;
  selectorMap: Map<number, DOMElementNode>;
}

