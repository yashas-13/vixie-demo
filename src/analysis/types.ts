export interface UIElement {
  selector: string;
  tagName: string;
  role: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
  isInteractive: boolean;
  importance: number; // 0-1
}

export interface PageFeature {
  id: string;
  pageUrl: string;
  pageTitle: string;
  element: UIElement;
  category: 'hero' | 'cta' | 'navigation' | 'form' | 'feature' | 'pricing' | 'testimonial' | 'footer' | 'other';
  description: string;
  screenshotPath: string;
}

export interface AnnotationSpec {
  featureId: string;
  arrow?: { from: { x: number; y: number }; to: { x: number; y: number } };
  highlight?: { x: number; y: number; width: number; height: number; style: 'glow' | 'border' | 'dim-bg' };
  zoom?: { x: number; y: number; scale: number };
  label?: { text: string; position: { x: number; y: number } };
}

export interface SiteManifest {
  url: string;
  title: string;
  pages: PageInfo[];
  features: PageFeature[];
  annotations: AnnotationSpec[];
}

export interface PageInfo {
  url: string;
  title: string;
  screenshotPath: string;
  elements: UIElement[];
}
