<template>
  <ajax-button
    :class="{'following': following}"
    type="button"
    :color="color"
    loading-text=""
    :fetching-data="ajaxing"
    :text="followingText"
    @clicked="followStore"
  />
</template>

<script>
  import {mapActions} from 'vuex'
  import AjaxButton from "~/components/AjaxButton";

  export default {
    name: 'FollowBtn',
    data() {
      return {
        ajaxing: false
      }
    },
    components: {
      AjaxButton,
    },
    props: {
      color: {
        type: String,
        default: '',
      },
      storeId: {
        required: true
      },
      following: {
        type: Boolean,
        default: false
      },
    },
    mixins: [],
    computed: {
      followingText() {
        return this.following ? this.$t('store.following') : this.$t('store.follow')
      },
    },
    methods: {
      async followStore() {
        if (!this.$auth?.loggedIn) {
          this.$auth.redirect('login')
          return
        }

        try {
          this.ajaxing = true
          const data = await this.postRequest({
            params: {
              store_id: this.storeId
            },
            api: 'followStore',
            requiredToken: true
          })

          this.ajaxing = false

          if (data.status === 200) {
            this.$emit('change-following')
          }
        } catch (e) {
          return this.$nuxt.error(e)
        }
      },
      ...mapActions('common', ['postRequest']),
    },
    async mounted() {


    },
  }
</script>

<style>

</style>
