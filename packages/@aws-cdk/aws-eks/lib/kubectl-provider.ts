import * as path from 'path';
import * as ec2  from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import { Construct, Duration, Stack } from '@aws-cdk/core';
import * as cr from '@aws-cdk/custom-resources';
import { ICluster, Cluster } from './cluster';
import { KubectlLayer } from './kubectl-layer';

export interface KubectlPrivateNetworkAccess {
  readonly securityGroup: ec2.ISecurityGroup;

  /**
   * Connect the provider to a VPC.
   *
   * @default - no vpc attachement.
   */
  readonly vpc: ec2.IVpc;

  /**
   * Select the Vpc subnets to attach to the provider.
   *
   * @default - no subnets.
   */
  readonly vpcSubnets: ec2.SubnetSelection[];
}

export interface KubectlProviderProps {
  /**
   * The ARN of the cluster to connect to.
   */
  readonly clusterArn: string;

  /**
   * The ARN of an IAM role that has administrative privilages on the cluster
   * and can issue kubectl commands against it.
   */
  readonly clusterAdminRoleArn: string;

  /**
   * If defined, the provider will be configured to access the cluster through
   * private VPC subnets.
   */
  readonly privateAccess?: KubectlPrivateNetworkAccess;

  /**
   * Environment variables to inject to the provider function.
   */
  readonly env?: { [key: string]: string };
}

export class KubectlProvider extends Construct {
  static getOrCreate(scope: Construct, cluster: ICluster) {

    // if this is an "owned" cluster, it has a provider associated with it
    if (cluster instanceof Cluster) {
      return cluster._attachKubectlResource(scope);
    }

    // if this is an imported cluster, we need to provision a custom resource provider in this stack
    // we will define one per stack for each cluster based on the cluster uniqueid
    const uid = `KubectlProviderFor${cluster.construct.uniqueId}`;
    const stack = Stack.of(scope);
    let provider = stack.construct.tryFindChild(uid) as KubectlProvider;
    if (!provider) {
      provider = new KubectlProvider(stack, uid, {
        clusterAdminRoleArn: cluster.clusterAdminRoleArn,
        clusterArn: cluster.clusterArn,
        // TODO: private access is not supported yet
        // TODO: kubectlEnv?
      });
    }

    return provider;
  }

  public readonly serviceToken: string;
  public readonly clusterAdminRoleArn: string;

  public constructor(scope: Construct, id: string, props: KubectlProviderProps) {
    super(scope, id);

    let vpc;
    let vpcSubnets;
    let securityGroups;

    if (props.privateAccess) {
      const privateSubents = queryPrivateSubnets(props.privateAccess).slice(0, 16);
      if (privateSubents.length === 0) {
        throw new Error('Vpc must contain private subnets to configure private endpoint access');
      }

      vpc = props.privateAccess.vpc;
      vpcSubnets = { subnets: privateSubents };
      securityGroups = [ props.privateAccess.securityGroup ];
    }

    const handler = new lambda.Function(this, 'Handler', {
      code: lambda.Code.fromAsset(path.join(__dirname, 'kubectl-handler')),
      runtime: lambda.Runtime.PYTHON_3_7,
      handler: 'index.handler',
      timeout: Duration.minutes(15),
      description: 'onEvent handler for EKS kubectl resource provider',
      layers: [ KubectlLayer.getOrCreate(this, { version: '2.0.0' }) ],
      memorySize: 256,
      environment: props.env,

      // defined only when using private access
      vpc: vpc,
      securityGroups: securityGroups,
      vpcSubnets: vpcSubnets,
    });

    handler.role?.addToPolicy(new iam.PolicyStatement({
      actions: [ 'eks:DescribeCluster' ],
      resources: [ props.clusterArn ],
    }));

    const provider = new cr.Provider(this, 'Provider', {
      onEventHandler: handler,
    });

    this.serviceToken = provider.serviceToken;
    this.clusterAdminRoleArn = props.clusterAdminRoleArn;
  }
}

function queryPrivateSubnets(props: KubectlPrivateNetworkAccess): ec2.ISubnet[] {
  const privateSubnets: ec2.ISubnet[] = [];

  for (const placement of props.vpcSubnets) {

    for (const subnet of props.vpc.selectSubnets(placement).subnets) {

      if (props.vpc.privateSubnets.includes(subnet)) {
        // definitely private, take it.
        privateSubnets.push(subnet);
        continue;
      }

      if (props.vpc.publicSubnets.includes(subnet)) {
        // definitely public, skip it.
        continue;
      }

      // neither public and nor private - what is it then? this means its a subnet instance that was explicitly passed
      // in the subnet selection. since ISubnet doesn't contain information on type, we have to assume its private and let it
      // fail at deploy time :\ (its better than filtering it out and preventing a possibly successful deployment)
      privateSubnets.push(subnet);
    }
  }

  return privateSubnets;
}
