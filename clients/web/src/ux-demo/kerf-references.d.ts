declare module 'virtual:glassbox-kerf-references' {
  const references: {
    id: string;
    name: string;
    category: string;
    description: string;
    useWhen: string[];
    uses: string[];
    documentation: string;
  }[];
  export default references;
}
