// The one place tours are looked up — module overviews (tours.ts) and
// page tours (pageTours.ts) together.
import { makePageTourRegistry } from './tours';
import { pageTours } from './pageTours';

export const { pageTourForPath, getTour } = makePageTourRegistry(pageTours);
