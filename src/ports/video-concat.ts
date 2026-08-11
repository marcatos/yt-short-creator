export type VideoConcatPort = {
  concat(input: {
    segmentPaths: string[];
    outputPath: string;
  }): Promise<string>;
};
