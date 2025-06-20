/* eslint-disable camelcase */
import { clerkClient } from "@clerk/clerk-sdk-node";
import { WebhookEvent } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { Webhook } from "svix";

import { createUser, deleteUser, updateUser } from "../../../../lib/actions/user.actions";

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Please add WEBHOOK_SECRET from Clerk Dashboard to .env or .env.local" },
      { status: 400 }
    );
  }

  const headerPayload = headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return NextResponse.json(
      { error: "Error occurred -- no svix headers" },
      { status: 400 }
    );
  }

  let payload;
  try {
    payload = await req.json();
    const body = JSON.stringify(payload);
    const wh = new Webhook(WEBHOOK_SECRET);

    const evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;

    const { id } = evt.data;
    const eventType = evt.type;

    // CREATE
    if (eventType === "user.created") {
      const { id, email_addresses, image_url, first_name, last_name, username } = evt.data;

      if (!email_addresses || email_addresses.length === 0) {
        return NextResponse.json(
          { error: "No email address provided" },
          { status: 400 }
        );
      }

      const user = {
        clerkId: id,
        email: email_addresses[0].email_address,
        username: username || `${first_name || ''}${last_name || ''}`.toLowerCase(),
        firstName: first_name || '',
        lastName: last_name || '',
        photo: image_url || '',
      };

      const newUser = await createUser(user);

      if (newUser) {
        await clerkClient.users.updateUserMetadata(id, {
          publicMetadata: {
            userId: newUser._id,
          },
        });
      }

      return NextResponse.json({ message: "OK", user: newUser });
    }

    // UPDATE
    if (eventType === "user.updated") {
      const { id, image_url, first_name, last_name, username } = evt.data;

      const user = {
        firstName: first_name || '',
        lastName: last_name || '',
        username: username || '',
        photo: image_url || '',
      };

      const updatedUser = await updateUser(id, user);
      return NextResponse.json({ message: "OK", user: updatedUser });
    }

    // DELETE - Improved version with proper type checking and error handling
    if (eventType === "user.deleted") {
      const { id } = evt.data;
      
      if (!id) {
        return NextResponse.json(
          { error: "No user ID provided for deletion" },
          { status: 400 }
        );
      }

      try {
        const deletedUser = await deleteUser(id);
        
        if (!deletedUser) {
          return NextResponse.json(
            { error: "User not found or could not be deleted" },
            { status: 404 }
          );
        }

        return NextResponse.json({ 
          message: "User deleted successfully",
          userId: id,
          user: deletedUser 
        });
      } catch (error) {
        console.error("Error deleting user:", error);
        return NextResponse.json(
          { error: "Failed to delete user" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { message: "Webhook processed", eventType },
      { status: 200 }
    );

  } catch (err) {
    console.error("Error processing webhook:", err);
    return NextResponse.json(
      { error: "Error occurred while processing webhook" },
      { status: 400 }
    );
  }
}