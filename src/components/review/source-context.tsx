import './source-context.css';

export interface SourceContextProps {
  identity: string;
  comparison: string;
}

export function SourceContext({ identity, comparison }: SourceContextProps) {
  return (
    <div class="source-context">
      <strong>{identity}</strong>
      <span>{comparison}</span>
    </div>
  );
}
