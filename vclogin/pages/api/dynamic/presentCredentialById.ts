import { NextApiRequest, NextApiResponse } from "next";
import { Redis } from "ioredis";
import { generatePresentationDefinition } from "@/lib/generatePresentationDefinition";
import { LoginPolicy } from "@/types/LoginPolicy";
import { extractClaims, isTrustedPresentation } from "@/lib/extractClaims";
import { verifyAuthenticationPresentation } from "@/lib/verifyPresentation";
import { getToken } from "@/lib/getToken";
import { logger } from "@/config/logger";

var redis: Redis;
try {
  redis = new Redis(parseInt(process.env.REDIS_PORT!), process.env.REDIS_HOST!);
} catch (error) {
  logger.error("Failed to connect to Redis:", error);
}

const getHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  logger.debug("LOGIN API GET BY ID");

  // Get login_id from query
  const uuid = req.query["login_id"];

  // fetch policy from redis using uuid
  const policy = await redis.get(uuid + "_policy");

  // fetch inputDescriptor from redis using uuid
  const inputDescriptor = await redis.get(uuid + "_inputDescriptor");
  logger.debug("inputDescriptor: ", JSON.parse(inputDescriptor!));

  //if policy is found
  if (policy) {
    const policyObject = JSON.parse(policy) as LoginPolicy;

    // generate presentation definition using policy
    // and inputDescriptor if it exists
    const presentation_definition = generatePresentationDefinition(
      policyObject,
      inputDescriptor ? JSON.parse(inputDescriptor) : undefined,
    );

    const challenge = req.query["login_id"];

    if (challenge) {
      const token = await getToken(
        challenge as string,
        process.env.EXTERNAL_URL + "/api/dynamic/clientMetadataById",
        process.env.EXTERNAL_URL + "/api/dynamic/presentCredentialById",
        presentation_definition,
        res,
      );

      res
        .status(200)
        .appendHeader("Content-Type", "application/oauth-authz-req+jwt")
        .send(token);
    }
  } else {
    res.status(500).end();
    return;
  }
};

const postHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  logger.debug("LOGIN API POST BY ID");

  // Parse the JSON string into a JavaScript object
  const presentation = JSON.parse(req.body.vp_token);
  logger.debug("Presentation: \n", req.body.vp_token);

  const uuid = presentation["proof"]["challenge"];
  const policy = await redis.get(uuid + "_policy");

  if (policy) {
    const policyObject = JSON.parse(policy) as LoginPolicy;

    // Constants for Redis to store the authentication result
    const MAX_AGE = 20 * 60;
    const EXPIRY_MS = "EX";

    // Verify the presentation and the status of the credential
    if (await verifyAuthenticationPresentation(presentation)) {
      logger.debug("Presentation valid");
      // Evaluate if the VP should be trusted
      if (await isTrustedPresentation(presentation, policyObject)) {
        logger.debug("Presentation verified");

        // Get the user claims when the presentation is trusted
        const userClaims = await extractClaims(presentation, policyObject);
        logger.debug(userClaims);

        // Store the authentication result in Redis
        await redis.set(uuid + "_auth-res", "success", EXPIRY_MS, MAX_AGE);

        // Store the user claims in Redis
        await redis.set(
          uuid + "_claims",
          JSON.stringify(userClaims.tokenId),
          EXPIRY_MS,
          MAX_AGE,
        );
      } else {
        logger.debug("Presentation not trusted");

        await redis.set(
          "auth_res:" + uuid,
          "error_presentation_not_trused",
          EXPIRY_MS,
          MAX_AGE,
        );
        // Wallet gets an error message
        res.status(500).end();
        return;
      }
    } else {
      logger.debug("Presentation invalid");
      await redis.set(
        "auth_res:" + uuid,
        "error_invalid_presentation",
        EXPIRY_MS,
        MAX_AGE,
      );
      res.status(500).end();
      return;
    }

    // Wallet gets 200 status code
    res.status(200).end();
  }
};

const handlers: any = {
  POST: postHandler,
  GET: getHandler,
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<any>, //todo look for separate handles
) {
  try {
    const { method } = req;
    if (method) {
      const execute = handlers[method.toUpperCase()];
      return await execute(req, res);
    }
  } catch (error) {
    res.status(500).end();
  }
}
