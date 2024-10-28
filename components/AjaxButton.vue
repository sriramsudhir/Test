<template>
  <button
    v-if="type === 'Submit'"
    class="ajax-btn"
    :aria-label="buttonText"
    :disabled="disable || disabled"
    :type="type"
  >
    <spinner
      v-if="fetchingData"
      :color="color"
      class="mr-15"
    />
    {{ buttonText }}
  </button>
  <button
    v-else
    @click.prevent="$emit('clicked')"
    class="ajax-btn"
    :disabled="disable || disabled"
    :type="type"
    :aria-label="buttonText"
  >
    <spinner
      v-if="fetchingData"
      :color="color"
    />
    <span
      v-if="loadingText && fetchingData"
      class="ml-15"
    >
       {{ loadingText }}
    </span>
    <span
      v-else-if="!fetchingData"
    >
       {{ buttonText }}
    </span>

  </button>
</template>

<script>
  import Spinner from "./Spinner"
  export default {
    name: 'AjaxButton',
    components: {
      Spinner
    },
    props: {
      color: {
        type: String,
        default: '',
      },
      text: {
        type: String,
        default: function () {
          return this.$t('ajaxButton.submit')
        }
      },
      loadingText: {
        type: String,
        default: function () {
          return this.$t('ajaxButton.gettingResponse')
        }
      },
      fetchingData: {
        type: Boolean,
        default: false,
      },
      disabled: {
        type: Boolean,
        default: false,
      },
      type: {
        type: String,
        default: 'Submit',
      },
    },
    computed: {
      buttonText() {
        return this.text
      },
      disable() {
        return this.fetchingData
      }
    }
  }
</script>

