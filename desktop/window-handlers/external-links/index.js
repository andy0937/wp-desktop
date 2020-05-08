'use strict';

/**
 * External Dependencies
 */
const { dialog } = require( 'electron' );
const shell = require( 'electron' ).shell;
const { URL, format } = require( 'url' );

/**
 * Internal dependencies
 */
const Config = require( 'lib/config' );
const Settings = require( 'lib/settings' );
const { showMySites } = require( 'lib/calypso-commands' );
const settingConstants = require( 'lib/settings/constants' );
const log = require( 'lib/logger' )( 'desktop:external-links' );

/**
 * Module variables
 */
const SCALE_NEW_WINDOW_FACTOR = 0.9;
const OFFSET_NEW_WINDOW = 50;

// Protocol doesn't matter - only the domain + path is checked
const ALWAYS_OPEN_IN_APP = [
	'http://' + Config.server_host,
	'http://localhost',
	'http://calypso.localhost:3000/*',
	'https:/public-api.wordpress.com',
	'https://wordpress\.com\/wp-login\.php',
	'http://127.0.0.1:41050/*',
];

const DONT_OPEN_IN_BROWSER = [
	Config.server_url,
	'https://public-api.wordpress.com/connect/'
];

const domainAndPathSame = ( first, second ) => first.hostname === second.hostname && ( first.pathname === second.pathname || second.pathname === '/*' );

function isValidBrowserUrl( url ) {
	const parsedUrl = new URL( url );

	if ( parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' ) {
		return url;
	}

	return false;
}

function isWpAdminLogin( url ) {
	const parsedURL = new URL( url );
	const isWpLogin = parsedURL.pathname.includes( 'wp-login.php' );
	const isReauth = parsedURL.searchParams ? parsedURL.searchParams.get( 'reauth' ) : null;
	return isWpLogin && isReauth;
}

function openInBrowser( event, url ) {
	if ( isValidBrowserUrl( url ) ) {
		log.info( `Using system default handler for URL: ${ url }` );
		shell.openExternal( url );
	}

	event.preventDefault();
}

function replaceInternalCalypsoUrl( url ) {
	if ( url.hostname === Config.server_host ) {
		log.info( 'Replacing internal url with public url', url.hostname, Config.wordpress_url );

		url.hostname = Config.wordpress_host;
		url.port = '';
	}

	return url;
}

module.exports = function( mainWindow ) {
	const webContents = mainWindow.webContents;

	webContents.on( 'will-navigate', function( event, url ) {
		const parsedUrl = new URL( url );

		// Handle wp-admin login events from Calypso (i.e. window.location.replace overrides)
		if ( isWpAdminLogin( url ) ) {
			log.info( `Ignoring window location override to URL: '${parsedUrl.origin + parsedUrl.pathname}'` );
			event.preventDefault();
		}

		for ( let x = 0; x < ALWAYS_OPEN_IN_APP.length; x++ ) {
			const alwaysOpenUrl = new URL( ALWAYS_OPEN_IN_APP[ x ] );

			if ( domainAndPathSame( parsedUrl, alwaysOpenUrl ) ) {
				return;
			}
		}

		openInBrowser( event, url );
	} );

	webContents.on( 'new-window', function( event, url, frameName, disposition, options ) {
		let parsedUrl = new URL( url );

		for ( let x = 0; x < DONT_OPEN_IN_BROWSER.length; x++ ) {
			const dontOpenUrl = new URL( DONT_OPEN_IN_BROWSER[ x ] );

			if ( domainAndPathSame( parsedUrl, dontOpenUrl ) ) {
				log.info( 'Open in new window for ' + url );

				// When we do open another Electron window make it a bit smaller so we know it's there
				// Having it exactly the same size means we just think the main window has changed page
				options.x = options.x + OFFSET_NEW_WINDOW;
				options.y = options.y + OFFSET_NEW_WINDOW;
				options.width = options.width * SCALE_NEW_WINDOW_FACTOR;
				options.height = options.height * SCALE_NEW_WINDOW_FACTOR;
				return;
			}
		}

		parsedUrl = replaceInternalCalypsoUrl( parsedUrl );

		const openUrl = format( parsedUrl );

		openInBrowser( event, openUrl );
	} );

	webContents.on( 'will-redirect', ( event, url ) => {
		const parsedURL = new URL( url );

		const promptWpAdminAuth = () => {
			try {
				const selected = dialog.showMessageBox( mainWindow, {
					type: 'info',
					buttons: [ 'Proceed in Browser', 'Cancel' ],
					title: 'Jetpack Authorization Required',
					message: 'This feature requires that Single Sign-On is enabled in the Jetpack settings of the site:' +
					'\n\n' +
					`${parsedURL.origin}`,
					detail: 'You may try again after changing the site\'s Jetpack settings, ' +
					'or you can proceed in an external browser.'
				} );

				switch ( selected ) {
					case 0:
						log.info( 'User selected \'Proceed in Browser\'...' )
						openInBrowser( event, url );
						break;
					case 1:
						log.info( 'User selected \'Cancel\'...' );
						break;
				}
				showMySites( mainWindow );
				// Update last location so redirect isn't automatically triggered on app relaunch
				Settings.saveSetting( settingConstants.LAST_LOCATION, `/stats/day/${parsedURL.hostname}` );
			} catch ( error ) {
				log.error( 'Failed to prompt for Jetpack authorization: ', error );
			}
		}

		// Handle external wp-admin login events (e.g. from Jetpack)
		if ( isWpAdminLogin( url ) ) {
			// Prevent default navigation regardless of option selected by user.
			event.preventDefault();
			promptWpAdminAuth( mainWindow, url );
		}
	} );
};
