import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';
import { signal } from 'kerfjs';

import type { Relocation } from '../../../components/discussion/discussion-state.js';
import { RelocationOffer } from '../../../components/discussion/relocation-offer.js';

// Each state the offer takes for a stale line comment; the Review Discussion demo and the real workbench run it live.
function offer(value: 'asking' | Relocation | null) {
  return { relocation: signal(value), pending: signal(false) };
}

export function RelocationOfferDemo() {
  return (
    <CatalogExampleStack label="Relocation Offer" rootAttributes={{ 'data-demo': 'relocation-offer' }}>
      <CatalogExample label="Not Asked" viewport={{ width: 'sidebar' }}>
        <RelocationOffer state={offer(null)} />
      </CatalogExample>
      <CatalogExample label="Looking" viewport={{ width: 'sidebar' }}>
        <RelocationOffer state={offer('asking')} />
      </CatalogExample>
      <CatalogExample label="One Match" viewport={{ width: 'sidebar' }}>
        <RelocationOffer
          state={offer({ outcome: 'suggestion', side: 'after', line: 42, text: 'const value = lookup(key);' })}
        />
      </CatalogExample>
      <CatalogExample label="More Than One Match" viewport={{ width: 'sidebar' }}>
        <RelocationOffer state={offer({ outcome: 'ambiguous' })} />
      </CatalogExample>
      <CatalogExample label="No Match" viewport={{ width: 'sidebar' }}>
        <RelocationOffer state={offer({ outcome: 'missing' })} />
      </CatalogExample>
      <CatalogExample label="Match in Hidden Lines" viewport={{ width: 'sidebar' }}>
        <RelocationOffer state={offer({ outcome: 'hidden' })} />
      </CatalogExample>
      <CatalogExample label="Text Not Recorded" viewport={{ width: 'sidebar' }}>
        <RelocationOffer state={offer({ outcome: 'unavailable' })} />
      </CatalogExample>
    </CatalogExampleStack>
  );
}
