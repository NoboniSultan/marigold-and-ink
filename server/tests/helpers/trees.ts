/**
 * A fake Digital Humani (TreePlanter) for tests: records requests, and can fail the next
 * call, or "lose the answer" (the request goes through, but the caller gets an error).
 */
import {
  TreePlanterError,
  type TreePlanter,
  type TreeRequest,
} from '../../src/adapters/digitalHumani.ts';

export function fakeTrees() {
  const requests: (TreeRequest & { reference: string })[] = [];
  const failNext = { plant: false, loseAnswer: false, find: false };
  let next = 0;

  const planter: TreePlanter = {
    async plantTrees({ treeCount, reference }) {
      if (failNext.plant) {
        failNext.plant = false;
        throw new TreePlanterError('Digital Humani answered 503', 503);
      }
      const request = { uuid: `tree-req-${++next}`, treeCount, reference };
      requests.push(request);
      if (failNext.loseAnswer) {
        failNext.loseAnswer = false;
        throw new TreePlanterError('Digital Humani could not be reached', null);
      }
      return { uuid: request.uuid, treeCount };
    },
    async findRequests(reference) {
      if (failNext.find) {
        failNext.find = false;
        throw new TreePlanterError('Digital Humani answered 500', 500);
      }
      return requests
        .filter((r) => r.reference === reference)
        .map(({ uuid, treeCount }) => ({ uuid, treeCount }));
    },
  };
  return { planter, requests, failNext };
}
