export type BrandTokens = {
  colors: {
    carbon: string;
    ice: string;
  };
  racingColors: {
    rossoCorsa: string;
  };
};

export type BrandPack = {
  tokens: BrandTokens;
  logoStackedPath: string;
  storyTemplatePath: string;
  accentHex: string;
};

export interface BrandPackPort {
  resolve(): Promise<BrandPack>;
}
