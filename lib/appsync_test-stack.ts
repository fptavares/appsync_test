import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';

export class AppsyncTestStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'ClientFeedProgramTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const api = new appsync.GraphqlApi(this, 'ProgramsApi', {
      name: 'ProgramsApi',
      definition: appsync.Definition.fromFile(path.join(__dirname, '../graphql/schema.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          /*apiKeyConfig: {
            expires: Duration.days(365),
          },*/
        },
      },
      xrayEnabled: true,
    });

    const apiKey = api.apiKey!;
    new CfnOutput(this, 'AppSyncApiKey', { value: apiKey });

    const gateway = new apigateway.RestApi(this, 'ProgramsApiGateway', {
      restApiName: 'ProgramsAPIGateway',
      deployOptions: {
        stageName: 'prod',
      },
    });

    const proxy = gateway.root.addResource('graphql');
    proxy.addMethod('POST', new apigateway.HttpIntegration(api.graphqlUrl), {
      apiKeyRequired: true,
    });

    const usagePlan = gateway.addUsagePlan('DefaultUsagePlan', {
      name: 'DefaultUsagePlan',
      throttle: {
        rateLimit: 100,
        burstLimit: 200,
      },
      quota: {
        limit: 600000,
        period: apigateway.Period.MONTH,
      },
    });

    const gatewayApiKey = gateway.addApiKey('ProgramsGatewayKey');
    usagePlan.addApiKey(gatewayApiKey);
    usagePlan.addApiStage({
      stage: gateway.deploymentStage,
      api: gateway,
    });

    new CfnOutput(this, 'GatewayURL', { value: gateway.url });

    const dataSource = api.addDynamoDbDataSource('TableDataSource', table);
    const resolversPath = path.join(__dirname, '../graphql/resolvers');

    dataSource.createResolver('QueryFeedsResolver', {
      typeName: 'Query',
      fieldName: 'feeds',
      requestMappingTemplate: appsync.MappingTemplate.fromFile(`${resolversPath}/Query.feeds.req.vtl`),
      responseMappingTemplate: appsync.MappingTemplate.fromFile(`${resolversPath}/Query.feeds.res.vtl`),
    });

    dataSource.createResolver('FeedProgramsResolver', {
      typeName: 'Feed',
      fieldName: 'programs',
      requestMappingTemplate: appsync.MappingTemplate.fromFile(`${resolversPath}/Feed.programs.req.vtl`),
      responseMappingTemplate: appsync.MappingTemplate.fromFile(`${resolversPath}/Feed.programs.res.vtl`),
    });
  }
}
