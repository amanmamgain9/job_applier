/**
 * DOM to Text - Converts DOM tree to readable text for LLM
 * 
 * Used by both page-analyzer and explorer
 */

import { DOMElementNode, DOMTextNode } from '../browser/dom/views';

/**
 * Describe what an interactive element does based on its attributes
 */
function describeInteraction(tagName: string, attributes: Record<string, string>): string {
  const hints: string[] = [];
  
  // Check aria attributes that describe behavior
  if (attributes['aria-expanded'] !== undefined) {
    hints.push(attributes['aria-expanded'] === 'true' ? 'expanded' : 'collapsed, click to expand');
  }
  if (attributes['aria-haspopup']) {
    const popup = attributes['aria-haspopup'];
    if (popup === 'dialog') hints.push('opens dialog');
    else if (popup === 'menu') hints.push('opens menu');
    else if (popup === 'listbox') hints.push('opens dropdown');
    else if (popup === 'true') hints.push('opens popup');
  }
  if (attributes['aria-controls']) {
    hints.push(`controls: ${attributes['aria-controls']}`);
  }
  if (attributes['aria-pressed'] !== undefined) {
    hints.push(attributes['aria-pressed'] === 'true' ? 'pressed/active' : 'not pressed');
  }
  if (attributes['aria-selected'] !== undefined) {
    hints.push(attributes['aria-selected'] === 'true' ? 'selected' : 'not selected');
  }
  if (attributes['aria-checked'] !== undefined) {
    hints.push(attributes['aria-checked'] === 'true' ? 'checked' : 'unchecked');
  }
  
  // Check type for inputs/buttons
  if (attributes.type) {
    if (attributes.type === 'submit') hints.push('submits form');
    else if (attributes.type === 'checkbox') hints.push('toggleable');
    else if (attributes.type === 'radio') hints.push('selectable option');
  }
  
  // Check for navigation
  if (tagName === 'a' && attributes.href) {
    if (attributes.href.startsWith('#')) hints.push('scrolls to section');
    else if (attributes.target === '_blank') hints.push('opens in new tab');
    else hints.push('navigates');
  }
  
  // Check role
  if (attributes.role) {
    if (attributes.role === 'tab') hints.push('switches tab');
    else if (attributes.role === 'switch') hints.push('toggleable switch');
    else if (attributes.role === 'menuitem') hints.push('menu action');
    else if (attributes.role === 'option') hints.push('selectable option');
  }
  
  return hints.length > 0 ? ` (${hints.join(', ')})` : '';
}

/**
 * Build a simple CSS selector for an element (used by explorer tools)
 */
export function buildSelector(node: DOMElementNode): string {
  const attributes = node.attributes || {};
  
  // Prefer id
  if (attributes.id) {
    return `#${attributes.id}`;
  }
  
  // Use data-testid if available
  if (attributes['data-testid']) {
    return `[data-testid="${attributes['data-testid']}"]`;
  }
  
  // Use aria-label
  if (attributes['aria-label']) {
    const label = String(attributes['aria-label']).slice(0, 30);
    return `${node.tagName}[aria-label="${label}"]`;
  }
  
  // Use class (first meaningful one)
  if (attributes.class) {
    const classes = String(attributes.class).split(' ').filter(c => 
      c.length > 2 && !c.includes('--') && !c.match(/^[a-z]{1,2}$/)
    );
    if (classes.length > 0) {
      return `${node.tagName}.${classes[0]}`;
    }
  }
  
  return node.tagName || 'div';
}

export interface DomToTextOptions {
  /** Include selector hints for clickable elements (for explorer) */
  includeSelectors?: boolean;
}

/**
 * Check if an element is likely boilerplate (header, nav, footer)
 * that should be condensed rather than fully expanded
 */
function isBoilerplateContainer(node: DOMElementNode): boolean {
  const tagName = node.tagName?.toLowerCase() || '';
  const attributes = node.attributes || {};
  const role = (attributes.role || '').toLowerCase();
  const id = (attributes.id || '').toLowerCase();
  const className = (attributes.class || '').toLowerCase();
  
  // Common boilerplate tags
  if (['header', 'footer', 'nav'].includes(tagName)) return true;
  
  // Role-based detection
  if (['navigation', 'banner', 'contentinfo'].includes(role)) return true;
  
  // ID/class patterns (common on LinkedIn)
  if (id.includes('header') || id.includes('footer') || id.includes('nav')) return true;
  if (className.includes('global-nav') || className.includes('header') || className.includes('footer')) return true;
  
  return false;
}

/**
 * Convert DOM tree to readable text for LLM
 */
export function domTreeToString(
  node: DOMElementNode | null, 
  options: DomToTextOptions = {},
  indent = 0,
  inBoilerplate = false
): string {
  const { includeSelectors = false } = options;
  
  if (!node) return '';
  
  const spaces = '  '.repeat(indent);
  let result = '';
  
  if (node.tagName) {
    const attributes = node.attributes || {};
    
    // Skip non-visible or noise elements
    if (['script', 'style', 'noscript', 'svg', 'path', 'code', 'img'].includes(node.tagName)) {
      return '';
    }
    
    // Check if entering boilerplate section
    const isBoilerplate = inBoilerplate || isBoilerplateContainer(node);
    
    // For boilerplate sections, only show interactive elements
    if (isBoilerplate && !node.isInteractive) {
      // Still recurse to find interactive children
      if (node.children) {
        for (const child of node.children) {
          if (child instanceof DOMElementNode) {
            result += domTreeToString(child, options, indent, true);
          }
        }
      }
      return result;
    }
    
    // Build a readable description
    const parts: string[] = [];
    
    // Element type
    parts.push(node.tagName);
    
    // Add meaningful identifiers
    if (attributes.id) parts.push(`#${attributes.id}`);
    if (attributes.role && attributes.role !== node.tagName) parts.push(`role="${attributes.role}"`);
    
    // Add aria-label which often describes purpose
    if (attributes['aria-label']) {
      parts.push(`"${String(attributes['aria-label']).slice(0, 50)}"`);
    }
    
    // For links, show where they go
    if (node.tagName === 'a' && attributes.href) {
      const href = String(attributes.href);
      if (href.length > 50) {
        parts.push(`href="...${href.slice(-30)}"`);
      } else {
        parts.push(`href="${href}"`);
      }
    }
    
    // For inputs, show type and placeholder
    if (node.tagName === 'input') {
      if (attributes.type) parts.push(`type="${attributes.type}"`);
      if (attributes.placeholder) parts.push(`placeholder="${attributes.placeholder}"`);
    }
    
    // Mark interactive elements with selector to use for clicking
    if (node.isInteractive) {
      const interactionDesc = describeInteraction(node.tagName, attributes);
      
      if (includeSelectors) {
        // Format: [CLICK: selector] (behavior hints)
        // This makes it crystal clear what selector to use
        const selector = buildSelector(node);
        parts.push(`[CLICK: "${selector}"${interactionDesc}]`);
      } else {
        parts.push(`[CLICKABLE${interactionDesc}]`);
      }
    }
    
    result += `${spaces}${parts.join(' ')}\n`;
    
    // Process children (pass boilerplate flag)
    if (node.children) {
      for (const child of node.children) {
        if (child instanceof DOMElementNode) {
          result += domTreeToString(child, options, indent + 1, isBoilerplate);
        } else if (child instanceof DOMTextNode && child.text && !isBoilerplate) {
          // Skip text in boilerplate sections (reduces noise)
          const text = child.text.trim();
          if (text.length > 0) {
            const truncated = text.slice(0, 100);
            result += `${spaces}  "${truncated}${text.length > 100 ? '...' : ''}"\n`;
          }
        }
      }
    }
  }
  
  return result;
}

