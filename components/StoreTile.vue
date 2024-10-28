<template>
  <div class="store-info">
    <div class="btn-wrap">
      <div class="">
        <p class="store-name">{{ storeName }}</p>
        <h6 class="store-date">{{$t('store.memberSince')}} <b class="block">{{storeDate}}</b></h6>
      </div>

      <div class="action-btn">
        <slot
          name="followBtn"
        />

        <nuxt-link
          class="visit-btn ajax-btn"
          :to="storeLink(store)"
        >
          {{$t('store.visitStore')}}
        </nuxt-link>
      </div>
    </div>

  </div>
</template>

<script>
  import moment from "moment";
  import util from "../mixin/util";
  import AjaxButton from "./AjaxButton";
  import FollowBtn from "./FollowBtn";

  export default {
    name: 'StoreTile',
    data() {
      return {
        ajaxing: false
      }
    },
    components: {
      FollowBtn,
      AjaxButton
    },
    props: {
      store: {
        type: Object
      },
    },
    mixins: [util],
    computed: {

      storeName(){
        return this.store?.name
      },

      storeDate(){
        return moment(this.store?.created_at).format('MMM DD, YYYY')
      },
    },
    methods: {
    },
    async mounted() {


    },
  }
</script>

<style>

</style>
