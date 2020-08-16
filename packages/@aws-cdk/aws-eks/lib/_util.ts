import { ArnComponents } from '@aws-cdk/core';

export function clusterArnComponents(clusterName: string): ArnComponents {
  return {
    service: 'eks',
    resource: 'cluster',
    resourceName: clusterName,
  };
}
