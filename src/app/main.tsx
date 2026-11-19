import '@kerfjs/ui/document.css';
import '@kerfjs/ui/layout.css';
import './style.css';

import { EmptyState } from '@kerfjs/ui/empty-state';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { mount } from 'kerfjs';
import { GitCompareArrows } from 'lucide';

import {
  createReviewWorkbenchState,
  ReviewWorkbench,
  wireReviewWorkbench,
} from '../components/review/review-workbench.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root.');

const workbench = createReviewWorkbenchState();
mount(root, () => (
  <ReviewWorkbench
    id="glassbox-workbench"
    state={workbench}
    projectTitle="Changed Files"
    comparisonTitle="Review"
    inspectorTitle="Inspector"
    navigator={<EmptyState title="No Review Files" />}
    comparison={
      <EmptyState title="No Review Open" icon={<LucideIcon icon={GitCompareArrows} name="git-compare-arrows" />} />
    }
    inspector={<EmptyState title="No Discussion Selected" />}
  />
));
void wireReviewWorkbench(root, 'glassbox-workbench', workbench);
