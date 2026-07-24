export type IssueSeverity = "info" | "warning" | "error";

export type IssueCategory =
  | "SEO"
  | "ACCESSIBILITY"
  | "PERFORMANCE"
  | "CONTENT";

export interface AuditIssue {
  category: IssueCategory;
  severity: IssueSeverity;
  message: string;
}

export interface AuditResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  responseTimeMs: number;

  title: {
    value: string | null;
    length: number;
  };

  metaDescription: {
    value: string | null;
    length: number;
  };

  headings: {
    h1: string[];
    h2Count: number;
  };

  links: {
    total: number;
    internal: number;
    external: number;
  };

  images: {
    total: number;
    withoutAlt: number;
  };

  page: {
    htmlSizeBytes: number;
    canonical: string | null;
    robots: string | null;
  };

  issues: AuditIssue[];

  auditedAt: string;
}