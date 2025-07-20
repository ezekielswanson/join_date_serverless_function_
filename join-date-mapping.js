const hubspot = require('@hubspot/api-client');

// ========================================
// JOIN DATE MAPPING - STRIPE WEBHOOK HANDLER
// ========================================
//
// PURPOSE: Capture the exact moment a member joins by processing 
// checkout.session.completed events and setting the join_date field 
// in HubSpot with a "write-once" policy.
//
// RELIABLE JOIN DATE SOURCE: event.created
// ==========================================

// Helper function to format join date as ISO string (YYYY-MM-DD)
const formatJoinDate = (unixTimestamp) => {
  try {
    // Convert Unix timestamp to JavaScript Date
    const date = new Date(unixTimestamp * 1000);
    
    // Format as YYYY-MM-DD (ISO format as per planning doc)
    return date.toISOString().split('T')[0];
  } catch (error) {
    throw new Error(`Date formatting failed: ${error.message}`);
  }
};

// Helper function to find HubSpot contact by email
const findContactByEmail = async (hubspotClient, email) => {
  try {
    console.log(`Searching for contact with email: ${email}`);
    
    const searchResult = await hubspotClient.crm.contacts.searchApi.doSearch({
      filterGroups: [{
        filters: [{
          propertyName: 'email',
          operator: 'EQ',
          value: email
        }]
      }],
      properties: ['join_date'], // Only request the field we need
      limit: 1
    });
    
    // DEBUG: Log the complete response structure
    console.log('Full searchResult:', JSON.stringify(searchResult, null, 2));
    console.log('searchResult type:', typeof searchResult);
    console.log('searchResult keys:', Object.keys(searchResult || {}));
    
    // Check if response is wrapped
    if (searchResult && searchResult.body) {
      console.log('Response has body property');
      console.log('body type:', typeof searchResult.body);
      console.log('body keys:', Object.keys(searchResult.body || {}));
    }
    
    // Safe access with fallback
    const results = searchResult?.results || searchResult?.body?.results || [];
    console.log(`Found ${results.length} contacts`);
    
    return results.length > 0 ? results[0] : null;
  } catch (error) {
    console.error('Search error details:', error);
    console.error('Error stack:', error.stack);
    throw new Error(`Contact search failed: ${error.message}`);
  }
};

// Main processing function for join date mapping
const processJoinDateMapping = async (hubspotClient, stripeEvent, customerEmail) => {
  try {
    if (!customerEmail) {
      throw new Error('No customer email found in checkout session');
    }
    
    // USE event.created FOR RELIABLE JOIN DATE
    // This is the exact moment payment completed and membership began
    const joinDate = formatJoinDate(stripeEvent.created);
    
    // Find the contact in HubSpot
    const contact = await findContactByEmail(hubspotClient, customerEmail);
    
    if (!contact) {
      throw new Error(`No contact found with email: ${customerEmail}`);
    }
    
    // WRITE-ONCE POLICY: Only set join_date if it's currently empty
    if (contact.properties.join_date) {
      console.log(`Join date already set for contact ${contact.id}`);
      return {
        success: true,
        action: 'skipped',
        message: 'Join date already exists',
        contactId: contact.id,
        existingJoinDate: contact.properties.join_date
      };
    }
    
    // Update the contact with the join date
    await hubspotClient.crm.contacts.basicApi.update(contact.id, {
      properties: {
        join_date: joinDate
      }
    });
    
    console.log(`Join date set: ${joinDate} for contact ${contact.id}`);
    
    return {
      success: true,
      action: 'updated',
      message: 'Join date successfully set',
      contactId: contact.id,
      joinDate: joinDate,
      contactEmail: customerEmail
    };
    
  } catch (error) {
    console.error(`Processing failed: ${error.message}`);
    throw error;
  }
};

// Main serverless function entry point
exports.main = async (context, sendResponse) => {
  console.log('BWC Join Date Mapping Started');
  
  try {
    // Get required secrets
    const hubspotToken = context.secrets.joinDateKey;
    
    if (!hubspotToken) {
      throw new Error('Missing required secret: joinDateKey');
    }
    
    // Initialize HubSpot client
    const hubspotClient = new hubspot.Client({ accessToken: hubspotToken });
    
    // Test HubSpot connectivity first
    try {
      console.log('Testing HubSpot API connectivity...');
      const testResult = await hubspotClient.crm.properties.coreApi.getAll('contacts', false);
      console.log('HubSpot API connectivity confirmed');
    } catch (apiError) {
      console.error('HubSpot API test failed:', apiError.message);
      throw new Error(`HubSpot authentication failed: ${apiError.message}`);
    }
    
    // Get customer email directly from context body
    const customerEmail = context.body.data.object.customer_details.email;
    console.log('Processing for customer email:', customerEmail);
    
    // DEBUG: Validate customer email
    if (!customerEmail) {
      throw new Error('No customer email found in webhook data');
    }
    
    // Parse the event for other data
    const rawBody = typeof context.body === 'string' ? context.body : JSON.stringify(context.body);
    const stripeEvent = JSON.parse(rawBody);
    
    // Only process checkout.session.completed events
    if (stripeEvent.type !== 'checkout.session.completed') {
      return sendResponse({
        statusCode: 200,
        body: { 
          status: 'ignored',
          message: `Event type ${stripeEvent.type} not processed`
        }
      });
    }
    
    console.log(`Processing event: ${stripeEvent.id}`);
    
    // Process the join date mapping
    const result = await processJoinDateMapping(hubspotClient, stripeEvent, customerEmail);
    
    // Send success response
    sendResponse({
      statusCode: 200,
      body: {
        status: 'success',
        action: result.action,
        message: result.message,
        data: {
          contactId: result.contactId,
          joinDate: result.joinDate,
          contactEmail: result.contactEmail,
          existingJoinDate: result.existingJoinDate,
          eventId: stripeEvent.id
        }
      }
    });
    
  } catch (error) {
    console.error(`Function error: ${error.message}`);
    
    sendResponse({
      statusCode: 500,
      body: {
        status: 'error',
        message: error.message
      }
    });
  }
};
