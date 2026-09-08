// Phase 20.11 — Browser Page Reader & Content Extractor
//
// Extracts structured text, forms, links, buttons, and inputs from web pages.

export interface ExtractedLink {
  text: string;
  href: string;
  target?: string;
}

export interface ExtractedForm {
  id?: string;
  name?: string;
  action?: string;
  method?: string;
  fields: { name: string; type: string; value?: string }[];
}

export interface ExtractedPageContent {
  title: string;
  url: string;
  text: string;
  links: ExtractedLink[];
  buttons: string[];
  forms: ExtractedForm[];
}

export class PageReader {
  /**
   * Parses raw HTML into accessible structured content and readable plain text.
   */
  public extractFromHtml(html: string, currentUrl = "about:blank"): ExtractedPageContent {
    // Extract title
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const title = titleMatch ? this.cleanText(titleMatch[1]) : "";

    // Extract links
    const links: ExtractedLink[] = [];
    const linkRegex = /<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const text = this.cleanText(match[2]);
      if (text && href && !href.startsWith("javascript:")) {
        links.push({ text, href });
      }
    }

    // Extract buttons
    const buttons: string[] = [];
    const buttonRegex = /<button[^>]*>([\s\S]*?)<\/button>/gi;
    while ((match = buttonRegex.exec(html)) !== null) {
      const btnText = this.cleanText(match[1]);
      if (btnText) buttons.push(btnText);
    }
    const inputButtonRegex = /<input[^>]*type=["'](?:button|submit)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
    while ((match = inputButtonRegex.exec(html)) !== null) {
      if (match[1]) buttons.push(this.cleanText(match[1]));
    }

    // Extract forms
    const forms: ExtractedForm[] = [];
    const formRegex = /<form([^>]*)>([\s\S]*?)<\/form>/gi;
    while ((match = formRegex.exec(html)) !== null) {
      const formAttrs = match[1];
      const formBody = match[2];

      const actionMatch = /action=["']([^"']*)["']/i.exec(formAttrs);
      const methodMatch = /method=["']([^"']*)["']/i.exec(formAttrs);

      const fields: ExtractedForm["fields"] = [];
      const fieldRegex = /<input\s+[^>]*name=["']([^"']*)["'][^>]*type=["']([^"']*)["'][^>]*>/gi;
      let fieldMatch: RegExpExecArray | null;
      while ((fieldMatch = fieldRegex.exec(formBody)) !== null) {
        fields.push({ name: fieldMatch[1], type: fieldMatch[2] });
      }

      forms.push({
        action: actionMatch ? actionMatch[1] : undefined,
        method: methodMatch ? methodMatch[1].toUpperCase() : "GET",
        fields,
      });
    }

    // Strip scripts, styles, and markup to get readable text
    let plainText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      title,
      url: currentUrl,
      text: plainText,
      links,
      buttons,
      forms,
    };
  }

  private cleanText(raw: string): string {
    return raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }
}

let pageReaderInstance: PageReader | null = null;
export function getPageReader(): PageReader {
  if (!pageReaderInstance) {
    pageReaderInstance = new PageReader();
  }
  return pageReaderInstance;
}
