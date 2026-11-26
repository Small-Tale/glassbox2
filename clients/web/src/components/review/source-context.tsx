import { Text } from '@kerfjs/ui/text';

export interface SourceContextProps {
  identity: string;
  comparison: string;
}

export function SourceContext({ identity, comparison }: SourceContextProps) {
  return (
    <div class="source-context">
      <Text weight="strong" size="default" wrap="anywhere">
        {identity}
      </Text>
      <Text tone="quiet" size="compact" wrap="anywhere">
        {comparison}
      </Text>
    </div>
  );
}
