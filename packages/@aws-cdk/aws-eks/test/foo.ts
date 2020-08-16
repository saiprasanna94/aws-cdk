import { Stack, App, Construct } from '@aws-cdk/core';
import { KubernetesResource, Cluster } from '../lib';

class MyStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const cluster = Cluster.fromClusterAttributes(this, 'MyCluster', {

    });

    new KubernetesResource(this, 'Foo', {
      cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: {
            name: 'my-config-map',
          },
          data: {
            foo: 1234,
            bar: 'hello',
          },
        },
      ],
    });
  }
}

const app = new App();
new MyStack(app, 'test-stack');

app.synth();