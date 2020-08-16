import * as iam from '@aws-cdk/aws-iam';
import { Construct, Lazy, Stack } from '@aws-cdk/core';
import { clusterArnComponents } from './_util';

export interface CreationRoleProps {
  readonly clusterName?: string;
  readonly clusterRoleArn: string;
  readonly vpcId: string;
}

export function createAdminRole(scope: Construct, props: CreationRoleProps) {
  const stack = Stack.of(scope);

  // the role used to create the cluster. this becomes the administrator role
  // of the cluster.
  const creationRole = new iam.Role(scope, 'CreationRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambdaBasicExecutionRole'),
    ],
  });

  // the CreateCluster API will allow the cluster to assume this role, so we
  // need to allow the lambda execution role to pass it.
  creationRole.addToPolicy(new iam.PolicyStatement({
    actions: [ 'iam:PassRole' ],
    resources: [ props.clusterRoleArn ],
  }));

  // if we know the cluster name, restrict the policy to only allow
  // interacting with this specific cluster otherwise, we will have to grant
  // this role to manage all clusters in the account. this must be lazy since
  // `props.name` may contain a lazy value that conditionally resolves to a
  // physical name.
  const clusterArns = Lazy.listValue({
    produce: () => {
      const arn = stack.formatArn(clusterArnComponents(stack.resolve(props.clusterName)));
      return stack.resolve(props.clusterName)
        ? [ arn, `${arn}/*` ] // see https://github.com/aws/aws-cdk/issues/6060
        : [ '*' ];
    },
  });

  const fargateProfileArn = Lazy.stringValue({
    produce: () => stack.resolve(props.clusterName)
      ? stack.formatArn({ service: 'eks', resource: 'fargateprofile', resourceName: stack.resolve(props.clusterName) + '/*' })
      : '*',
  });

  creationRole.addToPolicy(new iam.PolicyStatement({
    actions: [
      'eks:CreateCluster',
      'eks:DescribeCluster',
      'eks:DescribeUpdate',
      'eks:DeleteCluster',
      'eks:UpdateClusterVersion',
      'eks:UpdateClusterConfig',
      'eks:CreateFargateProfile',
      'eks:TagResource',
      'eks:UntagResource',
    ],
    resources: clusterArns,
  }));

  creationRole.addToPolicy(new iam.PolicyStatement({
    actions: [ 'eks:DescribeFargateProfile', 'eks:DeleteFargateProfile' ],
    resources: [ fargateProfileArn ],
  }));

  creationRole.addToPolicy(new iam.PolicyStatement({
    actions: [ 'iam:GetRole', 'iam:listAttachedRolePolicies', 'iam:CreateServiceLinkedRole' ],
    resources: [ '*' ],
  }));

  creationRole.addToPolicy(new iam.PolicyStatement({
    actions: [
      'ec2:DescribeSubnets',
      'ec2:DescribeRouteTables',
      'ec2:DescribeVpcs',
    ],
    resources: [ stack.formatArn({
      service: 'ec2',
      resource: 'vpc',
      resourceName: props.vpcId,
    }) ],
  }));

  return creationRole;
}
