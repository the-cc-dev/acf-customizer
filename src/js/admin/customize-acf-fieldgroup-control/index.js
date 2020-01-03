
(function( api, $, options ) {

	// store for acf's static validation callbacks
	var current_control,
		acf_customize_context,
		queue = [];

	// var _isEqual = _.isEqual,
	// 	isEqualPatch = function(object,other) {
	// 	if ( _.isObject(object) && _.isObject(other) && ! _isEqual( Object.keys(object), Object.keys(other) ) ) {
	// 		return false;
	// 	}
	// 	return _isEqual(object,other);
	// }

	// make sure fields get inited in the order they appear in the dom
	function enqueue(request,done) {
		var idx = queue.length,
			item = { idx:idx, request:request, done: done, finished:false, scope:null, arguments:null };

		queue.push( item );

		request.done( function(){
			var it;
			item.finished = true;
			item.self = this;
			item.arguments = arguments;
			while ( queue.length && queue[0].finished ) {
				it = queue.shift();
				it.done.apply( it.self, it.arguments );
			}
		} );
	}


	function expandRepeatables( expand ) {
		return expand.forEach(function($row){
			var field = acf.getField( $row.closest('.acf-field') );
			// collapse others
			$row.siblings().not($row).each(function(){
				if ( field.type === 'repeater' ) {
					field.collapse($(this));
				} else if ( field.type === 'flexible_content' ) {
					field.closeLayout($(this));
				}
			});

			if ( field.type === 'repeater' ) {
				field.expand($row);
			} else if ( field.type === 'flexible_content' ) {
				field.openLayout($row);
			}
		});

	}


	api.AcfFieldGroupControl = api.Control.extend({
		preview_context: {
			type: null,
			id: null,
		},
		initialize: function( id, opt ) {
			var control = this, args;

            args = opt || {};

			api.Control.prototype.initialize.call( control, id, args );

		},
		set_preview_context: function(context) {
			this.preview_context = context;
			return this;
		},
		ready: function() {
			var control = this,
				settings = this.setting();

			if ( 0 <= ['post','term','user'].indexOf( control.params.storage_type ) ) {
				// reload fields if preview url changed
				api.bind( 'acf-customize-context-changed', function( context ) {

					if ( context.type === control.params.storage_type ) {
						control
							.set_preview_context( context )
							.load_form();
					} else {
						control.unload_form();
					}
				} );

			}

			this.$wrapper = control.container.find('.acf-fields').first();
			acf.do_action( 'append', control.container );

			control.load_form();

			control.container.on('change','.acf-field', function(e){
				//*
				// check valid
				var $inputs = control.container.find('.acf-field :input[name]');

				acf.validation.errors = [];
				$inputs.each(function(){
					this.checkValidity();
				});

				acf.validation.busy = false;
				current_control = control;

				// reset validation status
				$( control.container ).data('acf',null);

				acf.validation.fetch( {
					form: control.container,
					lock:false,
					success:function($form) {
						// allow for submit
						// acf.validation.ignore = 1;
						// $button.trigger('click');
					},
					complete:function($form) {
						acf.unlockForm( $form );
						setTimeout( function(){ control.setting.preview(); }, 100 );
					}
				} );

			});

			api.Control.prototype.ready.apply( control, arguments );

		},
		load_form: function() {

			var control = this,
				request;

			request = wp.ajax.send( 'load_customizer_field_groups_' + control.id, {
				data: {
					wp_customize			: 'on',
					section_id				: control.id,
					acf_customize_context	: JSON.stringify( control.preview_context ),
					_nonce					: options.load_field_group_nonce,
				}
			} );


			enqueue( request, function(response) {

				control.$wrapper.html( response.html );

				control.init_fields();

			} );
			request.fail( function( response ) {
				console.log(' - load field group failure')
			} );

			request.always( function() {
				request = null;
			} );

		},
		unload_form: function() {
			var control = this;

			control.$wrapper.html( '' );
		},
		init_fields: function() {

			var control = this;

			control.$fields = control.container.find('.acf-fields > .acf-field');

			// will init fields
			setTimeout(function(){
				acf.doAction('ready', control.$wrapper);
				acf.doAction('prepare');
			},1);
		},
		updateValues: function() {
			var control = this,
				$inputs = control.container.find('.acf-field :input'),
				value;

			// convert object with prefixed numeric keys to array
			function fixNumKeys( obj ) {
				if ( $.isPlainObject( obj ) ) {
					// convert objects with numeric keys to array
					if ( Object.keys( obj ).join('').match(/^([0-9_]+)$/) ) {
						obj = Object.values( obj );
					}
					// recurse
					$.each( obj,function( i, el ){
						obj[i] = fixNumKeys( el );
					} );
				}
				return obj;
			}

			// prefix numeric keys with `_`
			// repeater field names have numeric keys, which get automatically sorted upon serialization.
			$inputs.each(function(){
				var name = $(this).attr('name');

				if ( ! name ) {
					return;
				}
				$(this).data('prev-name', name );
				$(this).attr('name',name.replace( /\[([0-9]+)\]/g, '\[_$1\]'));
			});

			value = $inputs.serializeJSON({
				useIntKeysAsArrayIndex:false,
			});

			// ... restoring field names to previous state
			$inputs.each(function(){
				$(this).attr( 'name', $(this).data('prev-name') );
				$(this).data('prev-name', null );
			});

			// force value update
			control.setting._value.___acf_customizer_dirty = true;
			// update customizer value
			control.setting.set( fixNumKeys( value[this.id ] ) );

		},
		focusField:function( path ) {
			var current, selector, $focusEl = this.$wrapper, expand = [];

			while ( path.length ) {
				current = path.pop();

				if ( _.isNumber( current ) ) {

					if ( $focusEl.is('[data-type="flexible_content"]') ) {
						$focusEl = $focusEl.find('> .acf-input > .acf-flexible-content > .values').children(':not(.acf-clone)').eq(current);
					} else if ( $focusEl.is('[data-type="repeater"]') ) {
						$focusEl = $focusEl.find('> .acf-input > .acf-repeater > .acf-table > tbody').children(':not(.acf-clone)').eq(current);
					} else {
						$focusEl = false;
					}
				} else {
					$focusEl = $focusEl.find('[data-key="'+current+'"]');
				}
				if ( !! $focusEl && $focusEl.is('[data-id]') ) {
					expand.push( $focusEl )
				}
				if ( ! $focusEl.length ) {
					return false;
				}
			}

			// focus control
			this.focus();

			setTimeout(function(){
				// expand repeatable, collapse others
				if ( expand.length ) {
					expandRepeatables( expand );
				}

				if ( ! _.isNumber( current ) ) {
					// focus input ..
					$focusEl.find('input').focus();
				} else {
					// ... or focus repeatable
					$focusEl.attr('tabindex',1).focus()
				}
			},500);
			return true;
		}
	});

	acf.add_action('validation_success', function(e) {
		current_control.updateValues();
	});
	acf.add_action('validation_failure',function(e){
		// need to remove acf message because it displays a wrong number of invalid fields
		current_control.container.find('> .acf-error-message').remove();
	});
	acf.add_action('invalid', function($input){
		acf.validation.busy = true;
	});



	api.bind('ready',function(){
		api.previewer.bind( 'acf-customize-context', function( new_val ) {
			var prev_val;
			prev_val = acf_customize_context
			if ( JSON.stringify(new_val) != JSON.stringify(prev_val) ) {
				api.trigger( 'acf-customize-context-changed', new_val )
			}
			acf_customize_context = new_val;

		});

		api.previewer.bind( 'focus-control-for-setting', function( settingId ) {
			// get clicked field ...
		});


		api.previewer.bind( 'acf-focus', function( path ) {
			var section_id = path.pop();
			console.log(section_id)
			try {
				api.control.each( function( control ) {
					if ( control.constructor === api.AcfFieldGroupControl && section_id === control.id ) {
						control.focusField( path );
						throw( 'break loop' );
					}
				});
			} catch(err){}
		});

	});


	api.bind( 'save-request-params', function(query){
		_.extend( query, {'acf_customize_context' : JSON.stringify( acf_customize_context )} ) ;
	} );
	//

 	api.controlConstructor['acf_customizer'] = api.AcfFieldGroupControl;

	api.bind('changeset-error', function(){
		//console.log(arguments)
	});



})( wp.customize, jQuery, acf_fieldgroup_control );
